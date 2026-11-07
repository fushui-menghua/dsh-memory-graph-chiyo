import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory, extractAndWrite, assembleContext, exportBundle, importBundle, saveBundle, loadBundle } from '../src/index.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-v05-'));
const DAY = 24 * 60 * 60 * 1000;

test('自动抽取：规则与事实都能抽出来，且带锚点', () => {
  const mem = createMemory({ dir: tmpDir() });
  const messages = [
    { text: '以后不要在深夜给我发消息' },
    { text: '我最喜欢下雨天了，家里养了一只猫叫豆豆' },
  ];
  const r = mem.extractAndWrite('user:alice', messages, { speaker: 'owner' });
  assert.ok(r.written.length >= 2, `应抽出至少 2 条，实际 ${r.written.length}`);
  assert.ok(r.written.some((n) => /深夜/.test(n.text)), '应包含规矩');
  assert.ok(r.written.some((n) => /猫/.test(n.text) || /下雨/.test(n.text)), '应包含事实');
  for (const n of r.written) assert.ok((n.anchors || []).length > 0, '每条都要有锚点');
});

test('自动抽取：敏感内容被跳过，不落盘', () => {
  const mem = createMemory({ dir: tmpDir() });
  const r = mem.extractAndWrite('user:alice', [{ text: '我喜欢住在 D:/work 那个地方' }], { speaker: 'owner' });
  assert.equal(r.written.length, 0);
  assert.ok(r.skipped.some((s) => s.why === 'sensitive'));
});

test('自动抽取：同样的话抽两次，第二次合并不新增', () => {
  const mem = createMemory({ dir: tmpDir() });
  const messages = [{ text: '我最喜欢下雨天了' }];
  const a = mem.extractAndWrite('user:alice', messages, { speaker: 'owner' });
  const b = mem.extractAndWrite('user:alice', messages, { speaker: 'owner' });
  assert.ok(a.written.length >= 1);
  const live = mem.load('user:alice').filter((n) => !n.archived);
  assert.equal(live.length, a.written.length, '第二次不应新增节点');
  assert.ok(b.merged.length >= 1, '第二次应走合并');
});

test('提示词装配：按 token 预算裁剪，带 id 与分区', () => {
  const mem = createMemory({ dir: tmpDir() });
  for (let i = 0; i < 20; i += 1) {
    mem.write('user:alice', { nodes: [{ kind: 'fact', text: `她喜欢第 ${i} 种下雨天`, anchors: [{ quote: `喜欢下雨天 ${i}` }] }] });
  }
  const small = mem.assembleContext({ scopes: ['user:alice'], query: '下雨', tokenBudget: 60 });
  const big = mem.assembleContext({ scopes: ['user:alice'], query: '下雨', tokenBudget: 2000 });
  assert.ok(small.tokens <= 60, `小预算应被裁到 60 以内，实际 ${small.tokens}`);
  assert.ok(big.used.length >= small.used.length, '大预算应带更多条目');
  assert.match(small.text, /【记得的事】/);
  assert.match(big.text, /\(n_/);
});

test('快照：导出再导入能完整还原', () => {
  const dirA = tmpDir();
  const memA = createMemory({ dir: dirA });
  memA.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
  const bundle = memA.exportBundle();
  assert.equal(bundle.format, 'dsh-memory-graph-chiyo/bundle');
  assert.ok(bundle.files.length >= 1);

  const file = path.join(tmpDir(), 'bundle.json');
  saveBundle(bundle, file);
  const loaded = loadBundle(file);
  const dirB = tmpDir();
  const r = importBundle(loaded, dirB);
  assert.ok(r.written >= 1);

  const memB = createMemory({ dir: dirB });
  const hits = memB.recall('user:alice', { query: '下雨' });
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /下雨天/);
});

test('关系衰减：半年后强度减半，低于阈值被摘掉', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  const a = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她怕黑', anchors: [{ quote: '我怕黑' }] }] });
  const id = a.written[0].id;
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '睡觉要留灯', anchors: [{ quote: '留灯' }], relations: [{ type: 'because', targetId: id }] }] });

  now += 180 * DAY; // 半个半衰期 = 强度 ×0.5
  mem.decayRelations('user:alice', { now });
  const node = mem.load('user:alice').find((n) => /留灯/.test(n.text));
  const w = Number(node.relations[0].weight);
  assert.ok(w > 0.4 && w <= 0.55, `半年后应约 0.5，实际 ${w}`);

  mem.decayRelations('user:alice', { now: now + 2000 * DAY, minWeight: 0.05 });
  const after = mem.load('user:alice').find((n) => /留灯/.test(n.text));
  assert.equal((after.relations || []).length, 0, '强度低于阈值应被摘掉');
});

test('共享记忆：每日配额与级联撤销、审计日志', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  const a = mem.proposeShared({ text: '雨天适合听老唱片', sourceScope: 'group:demo' });
  mem.proposeShared({ text: '猫喜欢纸箱', sourceScope: 'group:demo' });
  mem.proposeShared({ text: '深夜不要发消息', sourceScope: 'group:demo' });
  assert.throws(() => mem.proposeShared({ text: '第四条第', sourceScope: 'group:demo' }), /每日上限/);

  mem.approveShared(a.id, { by: 'owner' });
  now += DAY; // 配额按天算，第二天才能再提名
  const child = mem.proposeShared({ text: '雨天和老唱片一起', sourceScope: 'group:demo', dependsOn: [a.id] });
  mem.approveShared(child.id, { by: 'owner' });
  mem.revokeShared(a.id, { by: 'owner', reason: '不想公开' });

  const audit = mem.shared.audit({ limit: 20 });
  assert.ok(audit.length >= 3, '应有 propose/approve/revoke 审计');
  const childAfter = mem.listShared().find((e) => e.id === child.id);
  assert.equal(childAfter.status, 'revoked', '依赖条目应级联撤销');
});

test('store 缓存：写入后能立刻读到新数据（缓存失效正确）', () => {
  const mem = createMemory({ dir: tmpDir() });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '喜欢下雨' }] }] });
  const first = mem.load('user:alice').length;
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她怕黑', anchors: [{ quote: '怕黑' }] }] });
  const second = mem.load('user:alice').length;
  assert.equal(second, first + 1, '第二次写入后缓存应失效并读到新节点');
});
