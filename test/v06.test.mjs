import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory, polarityOf, findConflict, scanStore, repairStore } from '../src/index.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-v06-'));

test('极性判断：喜欢 vs 不喜欢', () => {
  assert.equal(polarityOf('她喜欢下雨天'), 'pos');
  assert.equal(polarityOf('她不喜欢下雨天'), 'neg');
  assert.equal(polarityOf('今天星期三'), 'neutral');
});

test('矛盾检测：新说法压旧说法，旧的不再召回但可 includeSuperseded 查到', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我喜欢下雨' }], category: 'preference' }] });
  now += 1000;
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她不喜欢下雨天', anchors: [{ quote: '我不喜欢下雨了' }], category: 'preference' }] });

  const defaultHits = mem.recall('user:alice', { query: '下雨' });
  assert.equal(defaultHits.length, 1, '默认只召回最新那条');
  assert.match(defaultHits[0].text, /不喜欢/);

  const all = mem.recall('user:alice', { query: '下雨', includeSuperseded: true });
  assert.equal(all.length, 2, '显式包含后能看到旧的');

  const oldNode = mem.load('user:alice').find((n) => /她喜欢下雨天/.test(n.text));
  assert.equal(oldNode.superseded, true);
  assert.ok(oldNode.supersededBy, '应记录被谁取代');
});

test('矛盾扫描：批量标出历史矛盾', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢猫', anchors: [{ quote: '喜欢猫' }] }] });
  now += 1000;
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她讨厌猫', anchors: [{ quote: '讨厌猫' }] }] });
  // 手动清掉 superseded 标记，模拟"历史遗留的未标记矛盾"
  for (const n of mem.load('user:alice')) {
    if (n.superseded) mem.store.append('user:alice', { ...n, superseded: false, updatedAt: now + 1 });
  }
  const found = mem.scanConflicts('user:alice', { apply: true });
  assert.ok(found.length >= 1, '应扫出矛盾');
  assert.ok(mem.load('user:alice').some((n) => n.superseded === true));
});

test('写锁：被别的进程占着时立刻失败（不无限等）', () => {
  const dir = tmpDir();
  const mem = createMemory({ dir });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '预热一条', anchors: [{ quote: 'x' }] }] });
  const scopeDir = path.join(dir, 'user_alice');
  const lock = path.join(scopeDir, '.lock');
  fs.mkdirSync(lock, { recursive: true });
  const t0 = Date.now();
  assert.throws(() => mem.write('user:alice', { nodes: [{ kind: 'fact', text: '被锁住时写', anchors: [{ quote: 'y' }] }] }), /锁住/);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 2500 && elapsed < 6000, `应等约 3 秒后失败，实际 ${elapsed}ms`);
  fs.rmdirSync(lock);
});

test('写锁：过期的锁会被自动清理', () => {
  const dir = tmpDir();
  const mem = createMemory({ dir });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '预热', anchors: [{ quote: 'x' }] }] });
  const lock = path.join(dir, 'user_alice', '.lock');
  fs.mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old); // 假装锁已经 60 秒没动
  const r = mem.write('user:alice', { nodes: [{ kind: 'fact', text: '锁过期也能写', anchors: [{ quote: 'z' }] }] });
  assert.equal(r.written.length, 1);
});

test('损坏修复：坏行被移走，好行保留，原文件备份', () => {
  const dir = tmpDir();
  const mem = createMemory({ dir });
  mem.write('user:alice', { nodes: [{ kind: 'fact', text: '好的一条', anchors: [{ quote: 'ok' }] }] });
  const file = path.join(dir, 'user_alice', fs.readdirSync(path.join(dir, 'user_alice')).find((f) => f.endsWith('.jsonl') && !f.startsWith('.')));
  fs.appendFileSync(file, '{"broken": true\n', 'utf8');

  const before = scanStore(dir);
  assert.equal(before.badFiles, 1);
  assert.equal(before.badLines, 1);

  const dry = repairStore(dir, { apply: false });
  assert.equal(dry.applied, false);

  const applied = repairStore(dir, { apply: true });
  assert.equal(applied.applied, true);
  assert.ok(applied.fixed.length === 1);
  const after = scanStore(dir);
  assert.equal(after.badLines, 0);
  const backups = fs.readdirSync(path.join(dir, 'user_alice')).filter((f) => f.includes('.bak-'));
  assert.equal(backups.length, 1, '应留一份备份');

  const mem2 = createMemory({ dir });
  assert.equal(mem2.recall('user:alice', { query: '好的一条' }).length, 1);
});

test('TypeScript 声明文件存在且声明了主要导出', () => {
  const dts = path.join(process.cwd(), 'index.d.ts');
  assert.ok(fs.existsSync(dts), '根目录应有 index.d.ts');
  const text = fs.readFileSync(dts, 'utf8');
  for (const name of ['createMemory', 'MemoryNode', 'CompactResult', 'SharedEntry', 'HealthReport', 'JsonlStore', 'MemoryGraph']) {
    assert.ok(text.includes(name), `声明里应有 ${name}`);
  }
});

test('性能护栏：2000 条节点纯召回平均 < 5ms', () => {
  const mem = createMemory({ dir: tmpDir() });
  const batch = [];
  for (let i = 0; i < 2000; i += 1) {
    batch.push({ kind: 'fact', text: `第 ${i} 条关于下雨和猫的事 ${i % 89}`, anchors: [{ quote: `第 ${i} 条` }], category: 'preference' });
    if (batch.length === 5) { mem.write('user:alice', { nodes: batch }); batch.length = 0; }
  }
  const t0 = Date.now();
  for (let i = 0; i < 100; i += 1) mem.recall('user:alice', { query: '下雨', limit: 10, track: false });
  const avg = (Date.now() - t0) / 100;
  assert.ok(avg < 5, `平均召回应在 5ms 内，实际 ${avg.toFixed(2)}ms`);
});
