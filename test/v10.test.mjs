import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory, createAccess, renderGalaxyHtml, backfill, validateBackfill } from '../src/index.js';
import { createBridgeMemory } from '../src/bridge.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-v10-'));
const DAY = 86400000;

test('补录：只允许 fact、最多 2 条、必须带证据、整批原子', () => {
  const mem = createMemory({ dir: tmpDir() });

  // 印象不能补录
  const bad1 = mem.backfill('agent:chiyo', {
    nodes: [{ kind: 'impression', text: '她好像不太高兴' }],
    evidence: { quote: '她那天没说话', source: '日记', sourceTime: '2026-11-01' },
  });
  assert.equal(bad1.ok, false);
  assert.ok(bad1.errors.some((e) => /只允许 fact/.test(e)));

  // 超过 2 条
  const bad2 = validateBackfill({
    nodes: [{ kind: 'fact', text: 'a' }, { kind: 'fact', text: 'b' }, { kind: 'fact', text: 'c' }],
    evidence: { quote: 'q', source: '旧记忆', sourceTime: '2026-01-01' },
  });
  assert.equal(bad2.ok, false);

  // 证据来源非法
  const bad3 = validateBackfill({
    nodes: [{ kind: 'fact', text: 'a' }],
    evidence: { quote: 'q', source: '群聊', sourceTime: '2026-01-01' },
  });
  assert.equal(bad3.ok, false);

  // 正常补录
  const ok = mem.backfill('agent:chiyo', {
    nodes: [{ kind: 'fact', text: '她以前养过一只叫团子的猫', anchors: [{ quote: '团子走了以后' }] }],
    evidence: { quote: '团子走了以后我就没再养', source: '日记', sourceTime: '2025-06-01' },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.weight, 0.8);
  const node = mem.load('agent:chiyo').find((n) => /团子/.test(n.text));
  assert.equal(node.origin, 'backfill');
  assert.equal(node.originWeight, 0.8);
});

test('权限：主人全通、群只读、未知主体默认拒', () => {
  const access = createAccess();
  assert.equal(access.can({ principal: 'owner', scope: 'group:123', action: 'write' }), true);
  assert.equal(access.can({ principal: 'group', scope: 'group:123', action: 'read' }), true);
  assert.equal(access.can({ principal: 'group', scope: 'group:123', action: 'write' }), false);
  assert.equal(access.can({ principal: 'stranger', scope: 'user:x', action: 'read' }), false);

  const mem = createMemory({ dir: tmpDir() });
  const guarded = access.guard(mem, { principal: 'group' });
  mem.write('group:123', { nodes: [{ kind: 'fact', text: '群里聊到下雨', anchors: [{ quote: '下雨' }] }] });
  assert.ok(guarded.read('group:123').length >= 1);
  assert.throws(() => guarded.write('group:123', { nodes: [{ kind: 'fact', text: 'x', anchors: [{ quote: 'x' }] }] }), /没有权限/);
});

test('人物：熟悉度增加、衰减、合并后关系重指', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.person.upsert({ name: '阿岚' });
  mem.person.bumpFamiliarity('阿岚', 0.5, { reason: '深聊了一次' });
  assert.ok(mem.person.resolve('阿岚').familiarity >= 0.5);

  now += 180 * DAY; // 半年不联系
  const changed = mem.person.decayFamiliarity({ halfLifeDays: 180 });
  assert.ok(changed.length >= 1);
  assert.ok(mem.person.resolve('阿岚').familiarity < 0.5);

  // 合并 + 重指
  mem.person.upsert({ name: '岚岚' });
  const a = mem.person.resolve('阿岚');
  const b = mem.person.resolve('岚岚');
  mem.write('agent:chiyo', { nodes: [{ kind: 'fact', text: '岚岚喜欢海', anchors: [{ quote: '喜欢海' }], relations: [{ type: 'person', targetId: b.id }] }] });
  const proposal = mem.person.proposeMerge('阿岚', '岚岚', { reason: '同一个人' });
  const r = mem.person.mergeAndRelink(mem.graph, proposal.id, { by: 'owner', scope: 'agent:chiyo' });
  assert.equal(r.relinked, 1);
  const node = mem.load('agent:chiyo').find((n) => /喜欢海/.test(n.text));
  assert.equal(node.relations[0].targetId, a.id, '关系应重指到合并后的人物');
});

test('星图完整版：生成可交互 HTML，含节点数据与交互代码', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.write('agent:chiyo', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '喜欢下雨' }] }] });
  const html = renderGalaxyHtml(mem.load('agent:chiyo'), { title: '测试星图', scope: 'agent:chiyo' });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /她喜欢下雨天/);
  assert.match(html, /addEventListener\('wheel'/);
  assert.match(html, /layerFilter/);
  assert.match(html, /锚点/);
});

test('桥接：observe 逐条喂消息，assistant 到达时自动抽取', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });
  bm.observe({ role: 'user', text: '我最喜欢下雨天了，还养了只猫叫豆豆' });
  const r = bm.observe({ role: 'assistant', text: '记住了' });
  assert.ok(r.written >= 1, '应在 assistant 到达时抽取');
  assert.ok(bm.recall('下雨').length >= 1);
});

test('桥接：做梦时间窗与待办节拍', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });
  bm.write([{ kind: 'fact', text: '她喜欢雨天', anchors: [{ quote: '喜欢雨天' }] }]);

  const night = new Date('2026-11-08T03:00:00+08:00').getTime();
  const tick = bm.dreamTick({ now: night, fromHour: 2, toHour: 7 });
  assert.ok(tick, '凌晨应能做梦');
  assert.ok(tick.seed.length >= 1);
  assert.match(tick.prompt, /揉成一个梦/);

  const day = new Date('2026-11-08T15:00:00+08:00').getTime();
  assert.equal(bm.dreamTick({ now: day }), null, '白天不该做梦');

  bm.tasks.add({ text: '整理星图' });
  const plan = bm.plan();
  assert.ok(plan);
  assert.equal(plan.suggestedMinutes, 15);
  assert.equal(bm.tasks.stats().doing, 1);
});
