import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/index.js';
import { createBridgeMemory } from '../src/bridge.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-v09-'));

test('情绪层：记心情、查当前、时间线、近七天摘要', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.mood.set('agent:chiyo', { label: '低落', intensity: 0.7, reason: '被说 AI 味重' });
  now += 60_000;
  mem.mood.set('agent:chiyo', { label: '暖', intensity: 0.6, reason: '主人说她写得好' });

  assert.equal(mem.mood.current('agent:chiyo').label, '暖');
  assert.equal(mem.mood.history('agent:chiyo').length, 2);
  const sum = mem.mood.summary('agent:chiyo');
  assert.match(sum, /现在：暖/);
  assert.match(sum, /近7天/);

  // 48 小时后当前心情视为"没记录"
  now += 50 * 3600 * 1000;
  assert.equal(mem.mood.current('agent:chiyo'), null);
});

test('情绪层：给记忆打情绪标签（带锚点）', () => {
  const mem = createMemory({ dir: tmpDir() });
  const node = mem.mood.tagMemory('agent:chiyo', { text: '想起那件事还在生气', label: '烦躁', anchor: '你又说我是AI' });
  assert.equal(node.category, 'emotion');
  assert.ok(node.anchors.length);
});

test('做梦：从记忆挑素材 → 生成提示词 → 记梦', () => {
  let now = 1_000_000_000_000;
  const mem = createMemory({ dir: tmpDir(), clock: () => now });
  mem.write('agent:chiyo', {
    nodes: [
      { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
      { kind: 'fact', text: '她养了一只猫叫豆豆', anchors: [{ quote: '豆豆又拆家了' }] },
    ],
  });
  const seed = mem.dream.seed(mem.graph, 'agent:chiyo');
  assert.ok(seed.length >= 2, '应挑到素材');
  assert.ok(seed.every((s) => s.quote), '素材要带原话');

  const prompt = mem.dream.buildPrompt(seed);
  assert.match(prompt, /揉成一个梦/);
  assert.match(prompt, /我最喜欢下雨了/);

  const tpl = mem.dream.templateDream(seed);
  assert.ok(tpl.length > 20, '没模型时也要能生成一段');

  const d = mem.dream.record({ scope: 'agent:chiyo', text: tpl, mood: '暖', seedIds: seed.map((s) => s.id), template: true });
  assert.ok(d.id);
  assert.equal(mem.dream.list({ scope: 'agent:chiyo' }).length, 1);
  assert.equal(mem.dream.latest({ scope: 'agent:chiyo' }).mood, '暖');
});

test('待办：加、挑下一件、完成、统计', () => {
  const mem = createMemory({ dir: tmpDir() });
  const a = mem.tasks.add('agent:chiyo', { text: '整理星图分类' });
  const b = mem.tasks.add('agent:chiyo', { text: '读一章小说' });
  assert.equal(mem.tasks.stats('agent:chiyo').todo, 2);
  assert.equal(mem.tasks.pickNext('agent:chiyo').id, a.id, '先挑最早创建的');

  mem.tasks.done('agent:chiyo', a.id, { note: '做了 3 条' });
  assert.equal(mem.tasks.stats('agent:chiyo').done, 1);
  assert.equal(mem.tasks.pickNext('agent:chiyo').id, b.id);
  assert.match(mem.tasks.summary('agent:chiyo'), /下一件：读一章小说/);

  mem.tasks.drop('agent:chiyo', b.id, { note: '不想读了' });
  assert.equal(mem.tasks.pickNext('agent:chiyo'), null);
});

test('桥接适配层暴露情绪 / 做梦 / 待办', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });
  bm.mood.set({ label: '平静', reason: '刚起床' });
  assert.equal(bm.mood.current().label, '平静');

  const t = bm.tasks.add({ text: '检查工具' });
  assert.equal(bm.tasks.pickNext().id, t.id);
  bm.tasks.done(t.id);
  assert.equal(bm.tasks.stats().done, 1);

  bm.write([{ kind: 'fact', text: '她喜欢雨天', anchors: [{ quote: '喜欢雨天' }] }]);
  const seed = bm.dream.seed();
  assert.ok(seed.length >= 1);
  const d = bm.dream.record({ text: '梦见下雨，门口有人叫我，醒过来只记得雨声。', mood: '暖' });
  assert.ok(d.id);
  assert.equal(bm.dream.list().length, 1);
});
