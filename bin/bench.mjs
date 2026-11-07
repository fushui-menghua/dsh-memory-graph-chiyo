#!/usr/bin/env node
/**
 * bench.mjs —— 性能基准：生成 N 条记忆，测写入/召回/整理耗时
 *
 *   node bin/bench.mjs 10000
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/index.js';

const N = Number(process.argv[2]) || 10000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-bench-'));
const mem = createMemory({ dir });

const words = ['下雨', '猫', '深夜', '海边', '唱片', '咖啡', '书', '散步', '旧照片', '风'];
const t0 = Date.now();
let batch = [];
let writeErrors = 0;
for (let i = 0; i < N; i += 1) {
  const w = words[i % words.length];
  batch.push({ kind: i % 7 === 0 ? 'impression' : 'fact', text: `第 ${i} 条：她${w}相关的事 ${i % 97}`, anchors: [{ quote: `${w} ${i}` }], category: 'preference' });
  // 单次最多写 5 条（options.maxNodesPerWrite），批量按 5 切
  if (batch.length === 5) {
    try { mem.write('user:bench', { nodes: batch, allowSensitive: true }); } catch (e) { writeErrors += 1; }
    batch = [];
  }
}
if (batch.length) mem.write('user:bench', { nodes: batch, allowSensitive: true });
const writeMs = Date.now() - t0;

const t1 = Date.now();
let hits = 0;
for (let i = 0; i < 200; i += 1) hits += mem.recall('user:bench', { query: words[i % words.length], limit: 20, track: false }).length;
const recallMs = Date.now() - t1;
const t1b = Date.now();
for (let i = 0; i < 50; i += 1) mem.recall('user:bench', { query: words[i % words.length], limit: 20 });
const recallTrackedMs = Date.now() - t1b;

const t2 = Date.now();
const cons = mem.consolidate('user:bench', { apply: false });
const consMs = Date.now() - t2;

const live = mem.load('user:bench').filter((n) => !n.archived).length;
console.log(JSON.stringify({
  nodes: live,
  writeMs,
  writePerSec: Math.round((live / Math.max(1, writeMs)) * 1000),
  writeErrors,
  recall200PureMs: recallMs,
  recallPureAvgMs: Number((recallMs / 200).toFixed(2)),
  recall50TrackedMs: recallTrackedMs,
  recallTrackedAvgMs: Number((recallTrackedMs / 50).toFixed(2)),
  hits,
  consolidateMs: consMs,
  candidates: { archive: cons.archived, reinforce: cons.reinforced },
  dir,
}, null, 2));
