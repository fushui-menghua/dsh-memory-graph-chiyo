import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/index.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-mem2-'));
const DAY = 24 * 60 * 60 * 1000;

test('跨 scope 召回：合并打分并带来源', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
  mem.write('agent:chiyo', { nodes: [{ kind: 'impression', text: '我那天也在想下雨的事', anchors: [{ quote: '雨' }] }] });

  const hits = mem.recallAcross(['user:alice', 'agent:chiyo'], { query: '下雨' });
  assert.ok(hits.length >= 2, '两个 scope 都应有命中');
  const scopes = new Set(hits.map((h) => h.scope));
  assert.ok(scopes.has('user:alice') && scopes.has('agent:chiyo'));
  // 排序：相关度高的在前
  assert.ok(hits[0].score >= hits[hits.length - 1].score);
});

test('共享记忆：提名不可见 → 批准可见 → 撤销不可见', () => {
  const mem = createMemory({ dir: tmpDir() });
  const e = mem.proposeShared({ text: '雨天适合听老唱片', sourceScope: 'group:demo', judgment: '她这么说的时候很轻' });
  assert.equal(e.status, 'proposed');
  assert.equal(mem.recallShared({ query: '雨天' }).length, 0, '未批准不应被召回');

  mem.approveShared(e.id, { by: 'owner' });
  const after = mem.recallShared({ query: '雨天' });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, e.id);

  mem.revokeShared(e.id, { by: 'owner', reason: '不想公开' });
  assert.equal(mem.recallShared({ query: '雨天' }).length, 0, '撤销后不应被召回');
  assert.equal(mem.listShared({ status: 'revoked' }).length, 1, '记录仍保留');
});

test('plan 生命周期：到期自动过期，过期后不再召回', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.write('user:alice', {
    nodes: [
      { kind: 'plan', text: '周末带她去看海', anchors: [{ quote: '周末去海边吧' }], validDays: 3 },
    ],
  });
  assert.equal(mem.recall('user:alice', { query: '看海' }).length, 1);

  now += 4 * DAY;
  const expired = mem.tickPlans('user:alice', { now });
  assert.equal(expired.length, 1, '应有过期');
  assert.equal(mem.recall('user:alice', { query: '看海' }).length, 0, '过期计划不再召回');
});

test('关系边：写入校验目标存在，召回可沿边扩展一跳', () => {
  const mem = createMemory({ dir: tmpDir() });
  // 目标不存在应被拒
  assert.throws(
    () => mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她怕黑', anchors: [{ quote: '我怕黑' }], relations: [{ type: 'because', targetId: 'n_missing' }] }] }),
    /不存在的节点/,
  );

  const first = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她怕黑', anchors: [{ quote: '我怕黑' }] }] });
  const id = first.written[0].id;
  mem.write('user:alice', {
    nodes: [{ kind: 'fact', text: '睡觉要留一盏小灯', anchors: [{ quote: '留个灯' }], relations: [{ type: 'because', targetId: id }] }],
  });

  const hits = mem.recall('user:alice', { query: '怕黑', hops: 1 });
  assert.ok(hits.some((h) => /小灯/.test(h.text)), '应沿 because 边带回关联节点');
  const linked = hits.find((h) => /小灯/.test(h.text));
  assert.ok(linked.relation === 'because' || linked.via, '关联节点应带关系标记');
});

test('nightly 一次跑完：层推进 + 即时记忆 + 计划过期 + 整理 + 体检', () => {
  let now = 1_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.write('user:alice', {
    nodes: [
      { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
      { kind: 'fact', text: '以后不要在深夜给她发消息', anchors: [{ quote: '深夜别找我' }] },
      { kind: 'plan', text: '周末去看海', anchors: [{ quote: '周末去海边' }], validDays: 1 },
    ],
  });
  mem.writeInstant('user:alice', { text: '今天聊到潮汐', topicKey: 'tide', eventKey: 'c1' });

  now += 10 * DAY;
  const report = mem.nightly(['user:alice'], { apply: true, now });
  assert.equal(report.scopes.length, 1);
  const s = report.scopes[0];
  assert.ok(s.plansExpired >= 1, '计划应过期');
  assert.ok(s.instant >= 1, '即时记忆应推进状态');
  assert.ok(s.reinforced >= 1, '规则类应被强化');
  assert.ok(s.health.live >= 1);
});
