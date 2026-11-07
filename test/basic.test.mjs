import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/index.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-mem-'));

test('fact 必须有锚点，否则拒收', () => {
  const mem = createMemory({ dir: tmpDir() });
  assert.throws(
    () => mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天' }] }),
    /至少需要 1 条锚点/,
  );
});

test('写入后能按语义召回，且召回会提升 recallCount', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.write('user:alice', {
    nodes: [
      { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
      { kind: 'fact', text: '她养了一只猫叫豆豆', anchors: [{ quote: '豆豆今天又拆家了' }] },
    ],
  });
  const hit = mem.recall('user:alice', { query: '下雨' });
  assert.ok(hit.length >= 1, '应该能召回下雨相关');
  assert.match(hit[0].text, /下雨/);
  const reloaded = mem.load('user:alice').find((n) => n.id === hit[0].id);
  assert.ok(Number(reloaded.recallCount) >= 1, 'recallCount 应被提升');
});

test('重复文本合并 mentionCount，不新建节点', () => {
  const mem = createMemory({ dir: tmpDir() });
  const one = { kind: 'fact', text: '她怕黑', anchors: [{ quote: '我怕黑' }] };
  mem.write('user:alice', { nodes: [one] });
  const r2 = mem.write('user:alice', { nodes: [one] });
  assert.equal(r2.merged.length, 1);
  assert.equal(r2.written.length, 0);
  const nodes = mem.load('user:alice');
  assert.equal(nodes.filter((n) => !n.archived).length, 1);
  assert.equal(nodes[0].mentionCount, 2);
});

test('即时记忆：醒 → 睡 → 墓碑，三次复活升级成 fact', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  const i = mem.writeInstant('user:alice', { text: '今天聊到了潮汐', topicKey: 'tide', eventKey: 'chat-1' });
  assert.equal(i.instantStatus, 'awake');

  now += 7 * 60 * 60 * 1000; // 7 小时后
  mem.tickInstant('user:alice', { now });
  assert.equal(mem.load('user:alice').find((n) => n.id === i.id).instantStatus, 'sleep');

  mem.reviveInstant('user:alice', { topicKey: 'tide', eventKey: 'chat-1' });
  mem.reviveInstant('user:alice', { topicKey: 'tide', eventKey: 'chat-1' });
  const third = mem.reviveInstant('user:alice', { topicKey: 'tide', eventKey: 'chat-1' });
  assert.ok(third.promoted, '第三次复活应升级成 fact');
  assert.equal(third.promoted.kind, 'fact');
});

test('夜间整理：归档重复、强化规则类', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.write('user:alice', {
    nodes: [
      { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
      { kind: 'fact', text: '以后不要在深夜给她发消息', anchors: [{ quote: '深夜别找我' }] },
    ],
  });
  // 模拟历史遗留：直接往 store 塞一条同文节点（绕过写入期去重），验证夜间整理能收拾掉
  const legacy = mem.load('user:alice')[0];
  mem.store.append('user:alice', {
    ...legacy, id: 'n_legacy_dup', mentionCount: 1, importance: 0.1,
    createdAt: legacy.createdAt, updatedAt: legacy.createdAt + 1,
  });
  const plan = mem.consolidate('user:alice', { apply: false });
  assert.ok(plan.archived >= 1, '应识别出重复节点');
  const applied = mem.consolidate('user:alice', { apply: true });
  assert.ok(applied.touched >= 1);
  const live = mem.load('user:alice').filter((n) => !n.archived);
  assert.equal(live.length, 2, '重复的被归档，剩 2 条');
  const rule = live.find((n) => /深夜/.test(n.text));
  assert.equal(rule.layer, 'long', '规则类应被强化到 long');
});

test('层推进：提及够多且够久 → short 升 long', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  const node = { kind: 'fact', text: '她喜欢猫', anchors: [{ quote: '猫最好了' }] };
  mem.write('user:alice', { nodes: [node] });
  mem.write('user:alice', { nodes: [node] });
  mem.write('user:alice', { nodes: [node] }); // 3 次
  now += 3 * 24 * 60 * 60 * 1000;
  const changes = mem.tickLayers('user:alice', { now });
  assert.ok(changes.some((c) => c.to === 'long'), '应升级到 long');
});

test('体检报告能给出分层与锚点覆盖率', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
  const h = mem.health('user:alice');
  assert.equal(h.live, 1);
  assert.equal(h.anchoredRatio, 1);
  assert.ok(h.byLayer.short >= 1);
});
