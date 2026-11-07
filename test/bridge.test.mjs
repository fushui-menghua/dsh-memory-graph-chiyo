import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBridgeMemory } from '../src/bridge.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-bridge-'));

test('桥接适配：afterTurn 自动抽取 → beforeTurn 自动注入', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });

  const r = bm.afterTurn({
    messages: [{ text: '我最喜欢下雨天了，家里养了一只猫叫豆豆' }],
    speaker: 'owner',
  });
  assert.ok(r.written >= 1, `应抽到记忆，实际 ${r.written}`);

  const block = bm.beforeTurn({ query: '下雨' });
  assert.match(block, /记得的事/);
  assert.match(block, /下雨/);
});

test('桥接适配：没有命中时返回空串（不污染提示词）', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });
  bm.write([{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '喜欢下雨' }] }]);
  const block = bm.beforeTurn({ query: '量子力学' });
  assert.equal(block, '');
});

test('桥接适配：extract=false 时 afterTurn 不写任何东西', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo', extract: false });
  const r = bm.afterTurn({ messages: [{ text: '我喜欢下雨天' }] });
  assert.equal(r.written, 0);
  assert.equal(r.disabled, true);
  assert.equal(bm.recall('下雨').length, 0);
});

test('桥接适配：nightly 默认 dry-run，apply 才改', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });
  bm.write([
    { kind: 'fact', text: '以后不要在深夜发消息', anchors: [{ quote: '深夜别找我' }] },
    { kind: 'fact', text: '她喜欢雨天', anchors: [{ quote: '喜欢雨天' }] },
  ]);
  const dry = bm.nightly();
  assert.equal(dry.apply, false);
  const applied = bm.nightly({ apply: true });
  assert.equal(applied.apply, true);
});

test('桥接适配：健康检查直接可用', () => {
  const bm = createBridgeMemory({ dir: tmpDir(), scope: 'agent:chiyo' });
  bm.write([{ kind: 'fact', text: '她喜欢雨天', anchors: [{ quote: '喜欢雨天' }] }]);
  const h = bm.health();
  assert.equal(h.checks.length, 6);
  assert.equal(h.live, 1);
});
