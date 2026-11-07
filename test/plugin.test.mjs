import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-plugin-'));

test('插件 apply：注册 5 个工具，能写能读', async () => {
  const { apply } = await import('../plugin.js');
  const tools = new Map();
  const ctx = {
    tools: { register: (t) => tools.set(t.name, t) },
    logger: { info() {}, warn() {} },
  };
  const dir = tmpDir();
  const info = apply(ctx, { dir, scope: 'user:plugin' });

  assert.equal(info.registered, 5, '应注册 5 个工具');
  for (const name of ['memory_write', 'memory_recall', 'memory_health', 'memory_nightly', 'memory_shared']) {
    assert.ok(tools.has(name), `缺少工具 ${name}`);
  }

  // 写
  const w = await tools.get('memory_write').execute({
    kind: 'fact',
    text: '她喜欢下雨天',
    anchors: [{ quote: '我最喜欢下雨了' }],
    category: 'preference',
  });
  assert.equal(w.written, 1);

  // 读
  const hits = await tools.get('memory_recall').execute({ query: '下雨' });
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /下雨/);
  assert.ok(hits[0].id);
});

test('插件工具：生成合法 JSON Schema（宿主兜底路径）', async () => {
  const { apply, toJsonSchema } = await import('../plugin.js');
  const tools = new Map();
  const ctx = { tools: { register: (t) => tools.set(t.name, t) }, logger: {} };
  apply(ctx, { dir: tmpDir() });

  const schema = tools.get('memory_write').parameters;
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties.kind);
  assert.deepEqual(schema.required.sort(), ['kind', 'text'].sort(), '只有显式 required 的才必填');
  assert.equal(schema.additionalProperties, false);

  // 兜底函数本身
  const s2 = toJsonSchema({ a: { type: 'string', required: true }, b: { type: 'string' } });
  assert.deepEqual(s2.required, ['a']);
});

test('插件工具：体检与夜间整理（dry-run 不改数据）', async () => {
  const { apply } = await import('../plugin.js');
  const tools = new Map();
  const ctx = { tools: { register: (t) => tools.set(t.name, t) }, logger: {} };
  apply(ctx, { dir: tmpDir(), scope: 'user:plugin' });

  await tools.get('memory_write').execute({ kind: 'fact', text: '她喜欢雨天', anchors: [{ quote: '喜欢雨天' }] });
  const health = await tools.get('memory_health').execute({});
  assert.ok(Array.isArray(health.checks));
  assert.equal(health.checks.length, 6);

  const nightly = await tools.get('memory_nightly').execute({ apply: false });
  assert.equal(nightly.apply, false);
  assert.ok(Array.isArray(nightly.scopes));
});

test('插件工具：共享记忆流程', async () => {
  const { apply } = await import('../plugin.js');
  const tools = new Map();
  const ctx = { tools: { register: (t) => tools.set(t.name, t) }, logger: {} };
  apply(ctx, { dir: tmpDir() });
  const shared = tools.get('memory_shared');

  const p = await shared.execute({ action: 'propose', text: '雨天适合听老唱片', sourceScope: 'user:plugin', by: 'owner' });
  assert.equal(p.status, 'proposed');
  const listed = await shared.execute({ action: 'list' });
  assert.ok(listed.some((e) => e.id === p.id));
  const ap = await shared.execute({ action: 'approve', id: p.id, by: 'owner' });
  assert.equal(ap.status, 'approved');
  const rv = await shared.execute({ action: 'revoke', id: p.id, by: 'owner' });
  assert.equal(rv.status, 'revoked');
});
