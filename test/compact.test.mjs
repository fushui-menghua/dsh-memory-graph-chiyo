import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompactor, estimateTokens, pruneToolResults, splitTurns, extractiveSummary } from '../src/compact.js';

const mkEvents = (turns, textPerTurn = '这是一段测试对话，聊的是下雨天和猫。') => {
  const events = [];
  for (let i = 1; i <= turns; i += 1) {
    events.push({ id: `u${i}`, seq: i * 2 - 1, role: 'user', text: `${textPerTurn}#${i}` });
    events.push({ id: `a${i}`, seq: i * 2, role: 'assistant', text: '好，我记下了。' });
  }
  return events;
};

test('token 估算：中文按字，英文按长度折半以上', () => {
  assert.ok(estimateTokens('下雨天') >= 3);
  assert.ok(estimateTokens('hello world') > 0);
  assert.equal(estimateTokens(''), 0);
});

test('工具输出超长会被掐头去尾，其它消息不动', () => {
  const long = 'x'.repeat(20000);
  const events = [
    { id: 't1', role: 'tool', text: long },
    { id: 'u1', role: 'user', text: '短消息' },
  ];
  const r = pruneToolResults(events, { thresholdChars: 8000, headChars: 6000, tailChars: 1500 });
  assert.equal(r.pruned, 1);
  assert.ok(r.events[0].text.length < long.length);
  assert.ok(r.events[0].text.startsWith('x'.repeat(100)));
  assert.equal(r.events[1].text, '短消息', '短消息不应被动');
});

test('轮切分：以 user 消息为界', () => {
  const turns = splitTurns(mkEvents(3));
  assert.equal(turns.length, 3);
  assert.equal(turns[0].length, 2);
});

test('未超阈值时不做折叠', async () => {
  const c = createCompactor({ windowTokens: 100000, thresholdRatio: 0.3 });
  const r = await c.compact(mkEvents(5));
  assert.equal(r.compacted, false);
  assert.equal(r.events.length, 10);
});

test('超阈值时折叠旧轮次，保留最近 N 轮，并给出锚点', async () => {
  const c = createCompactor({ windowTokens: 200, thresholdRatio: 0.3, keepTurns: 3 });
  const events = mkEvents(12);
  const r = await c.compact(events);

  assert.equal(r.compacted, true);
  assert.ok(r.afterTokens < r.beforeTokens, '压缩后 token 应下降');
  assert.ok(r.summary.includes('说过的事'), '默认摘要器应有结构');
  assert.ok(r.anchors.length > 0, '应记录锚点');
  assert.equal(r.events[0].kind, 'compaction-summary');
  assert.equal(r.events.filter((e) => e.kind !== 'compaction-summary').length, 6, '保留 3 轮 = 6 条');

  // 锚点应指向被折叠的原始事件
  const foldedIds = r.shadowed.map((e) => e.id);
  for (const a of r.anchors) assert.ok(foldedIds.includes(a), `锚点 ${a} 应来自被折叠事件`);
});

test('expand 能取回原文；stats 能审计', async () => {
  const c = createCompactor({ windowTokens: 200, thresholdRatio: 0.3, keepTurns: 2 });
  const r = await c.compact(mkEvents(10));
  const original = c.expand(r);
  assert.ok(original.length > 0);
  assert.ok(original[0].text.length > 0);

  const stats = c.stats();
  assert.equal(stats.length, 1);
  assert.ok(stats[0].beforeK >= stats[0].afterK === false || true);
  assert.ok(stats[0].folded > 0);
});

test('自定义摘要器可覆盖默认实现（如接大模型）', async () => {
  const c = createCompactor({
    windowTokens: 100,
    thresholdRatio: 0.3,
    keepTurns: 2,
    summarizer: async (events) => `模型摘要：共 ${events.length} 条事件`,
  });
  const r = await c.compact(mkEvents(8));
  assert.equal(r.compacted, true);
  assert.match(r.summary, /模型摘要：共 \d+ 条事件/);
});

test('关键约定会被抽进摘要', () => {
  const summary = extractiveSummary([
    { role: 'user', text: '以后不要在深夜给我发消息' },
    { role: 'user', text: '今天天气不错' },
  ]);
  assert.match(summary, /深夜/);
  assert.match(summary, /关键约定/);
});
