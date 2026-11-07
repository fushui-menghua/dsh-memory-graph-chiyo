import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory, extractRules, renderStarMap, renderMermaid, scanSensitive } from '../src/index.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-mem4-'));

test('敏感内容默认拒收（路径 / QQ号 / 令牌）', () => {
  const mem = createMemory({ dir: tmpDir() });
  const anchors = [{ quote: '我家在 D:/work 那边' }];
  assert.throws(
    () => mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她家路径 D:/work', anchors }] }),
    /敏感内容/,
  );
  assert.throws(
    () => mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她的号码是 3283312840', anchors: [{ quote: '号' }] }] }),
    /敏感内容/,
  );
  // 显式放行可以写
  const ok = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她家路径 D:/work', anchors, idempotencyKey: 'path-1' }], allowSensitive: true });
  assert.ok(ok.written.length >= 0);
});

test('锚点强校验：原文里找不到就拒收', () => {
  const mem = createMemory({ dir: tmpDir() });
  const messages = [{ text: '我最喜欢下雨天了' }];
  assert.throws(
    () => mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我每天都盼着下雨' }] }], messages }),
    /锚点在原文里找不到/,
  );
  const ok = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '喜欢下雨天了' }] }], messages });
  assert.equal(ok.written.length, 1);
});

test('幂等键去重：同一 key 换说法也只留一条', () => {
  const mem = createMemory({ dir: tmpDir() });
  const a = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }], idempotencyKey: 'rain-1' }] });
  const b = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '下雨天她会很开心', anchors: [{ quote: '下雨就开心' }], idempotencyKey: 'rain-1' }] });
  assert.equal(b.written.length, 0);
  assert.equal(b.merged.length, 1);
  const live = mem.load('user:alice').filter((n) => !n.archived);
  assert.equal(live.length, 1, '同 key 不应新增节点');
  assert.equal(live[0].mentionCount, 2);
});

test('规则抽取：识别主人的规矩与她自己的承诺', () => {
  const owner = extractRules('以后不要在深夜给我发消息。今天天气不错。', { speaker: 'owner' });
  assert.equal(owner.length, 1);
  assert.equal(owner[0].cluster, 'rule-owner');
  assert.ok(owner[0].anchors.length);

  const self = extractRules('我以后先自己验一遍再给你看', { speaker: 'self' });
  assert.equal(self.length, 1);
  assert.equal(self[0].cluster, 'rule-self');

  assert.equal(extractRules('今天吃了面', { speaker: 'owner' }).length, 0);
});

test('人物层：登记、别名解析、合并审批', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.person.upsert({ name: '阿岚', aliases: ['小岚'], note: '喜欢海' });
  assert.ok(mem.person.resolve('小岚'));
  mem.person.upsert({ name: '岚岚' });
  const proposal = mem.person.proposeMerge('阿岚', '岚岚', { reason: '同一个人的两个叫法' });
  assert.equal(proposal.status, 'proposed');
  const merged = mem.person.approveMerge(proposal.id, { by: 'owner' });
  assert.ok(merged.aliases.includes('岚岚'));
  assert.equal(mem.person.resolve('岚岚')?.name, '阿岚');
});

test('时间线：episode 汇总 + 漏检扫描', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
  const ep = mem.episode({ scope: 'user:alice', from: Date.now() - 3600_000, to: Date.now() + 1000 });
  assert.equal(ep.total, 1);
  assert.ok(ep.highlights.length >= 1);

  const scan = mem.missedScan({
    scope: 'user:alice',
    messages: [{ text: '我最喜欢下雨了' }, { text: '今天去了海边，风很大，浪也很大' }],
  });
  assert.equal(scan.missed.length, 1, '只有没被引用过的那条算漏记');
  assert.match(scan.missed[0].text, /海边/);
});

test('体检 6 项：没锚点的记录会让锚点覆盖率不达标', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  // impression 可以不写锚点 → 覆盖率 0
  mem.write('user:alice', { nodes: [{ kind: 'impression', text: '她好像有点累了' }] });
  const r = mem.healthReport({ scope: 'user:alice', now });
  assert.equal(r.checks.length, 6);
  assert.equal(r.checks[0].name, '锚点覆盖率');
  assert.equal(r.checks[0].ok, false);
  assert.ok(r.failed.includes('锚点覆盖率'));
});

test('人格旋钮：单步、每日次数与漂移都有刹车', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  const before = mem.persona.get().initiative;
  mem.persona.tune('initiative', 0.5, { by: 'owner', reason: '希望更主动' });
  const after = mem.persona.get().initiative;
  assert.ok(after - before <= 0.05 + 1e-9, '单次不能超过 maxStep');
  assert.throws(() => mem.persona.tune('initiative', 0.01, { by: 'owner' }), /今天已经调过/);

  now += 24 * 60 * 60 * 1000; // 第二天
  for (let i = 0; i < 10; i += 1) {
    try { mem.persona.tune('initiative', 0.05, { by: 'owner' }); } catch {}
    now += 24 * 60 * 60 * 1000;
  }
  const final = mem.persona.get().initiative;
  const state = mem.persona.state();
  assert.ok(Math.abs(final - state.base.initiative) <= 0.15 + 1e-9, '累计漂移不超过 maxDrift');
  assert.match(mem.persona.summary(), /主动/);
});

test('星图：SVG 与 Mermaid 都能产出合法文本', () => {
  const mem = createMemory({ dir: tmpDir() });
  const a = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
  const id = a.written[0].id;
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '下雨天要带伞', anchors: [{ quote: '记得带伞' }], relations: [{ type: 'because', targetId: id }] }] });

  const nodes = mem.load('user:alice');
  const svg = renderStarMap(nodes, { title: '测试星图' });
  assert.ok(svg.startsWith('<?xml'));
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('测试星图'));
  assert.match(svg, /<circle/);
  assert.ok(svg.includes('下雨天'));

  const mermaid = renderMermaid(nodes);
  assert.match(mermaid, /^graph TD/);
  assert.match(mermaid, /-->\|because\|/);
});

test('敏感扫描可单独调用（展示层也能用）', () => {
  const hits = scanSensitive('token: abc，家在 C:\\Users\\me');
  const types = hits.map((h) => h.type);
  assert.ok(types.includes('credential'));
  assert.ok(types.includes('path'));
  assert.equal(scanSensitive('今天天气不错').length, 0);
});
