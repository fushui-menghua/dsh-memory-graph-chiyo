#!/usr/bin/env node
/**
 * recall-eval.mjs —— 召回基线评测
 *
 * 做法：生成一批带唯一关键词的记忆，每个关键词当一次查询，
 * 看目标节点是否出现在第 1 名 / 前 3 名。
 *
 *   node bin/recall-eval.mjs            # 默认 200 条
 *   node bin/recall-eval.mjs 500
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/index.js';

const N = Number(process.argv[2]) || 200;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-eval-'));
const mem = createMemory({ dir });
const scope = 'user:eval';

const topics = ['下雨', '猫', '深夜', '海边', '唱片', '咖啡', '书', '散步', '旧照片', '风', '潮汐', '烟花', '雪', '车站', '老房子'];
const cases = [];
for (let i = 0; i < N; i += 1) {
  const t = topics[i % topics.length];
  const text = `关于${t}的记忆第${i}条：她提到${t}时说起一件小事`;
  mem.write(scope, { nodes: [{ kind: 'fact', text, anchors: [{ quote: `${t} ${i}` }], category: 'preference' }] });
  cases.push({ query: `${t} 第${i}条`, expect: text });
}

let hit1 = 0;
let hit3 = 0;
const misses = [];
for (const c of cases) {
  const hits = mem.recall(scope, { query: c.query, limit: 3, track: false });
  const idx = hits.findIndex((h) => h.text === c.expect);
  if (idx === 0) hit1 += 1;
  if (idx >= 0 && idx < 3) hit3 += 1;
  else misses.push({ query: c.query, got: hits.map((h) => h.text.slice(0, 30)) });
}

console.log(JSON.stringify({
  nodes: N,
  queries: cases.length,
  hitAt1: `${((hit1 / cases.length) * 100).toFixed(1)}%`,
  hitAt3: `${((hit3 / cases.length) * 100).toFixed(1)}%`,
  misses: misses.length,
  sampleMisses: misses.slice(0, 3),
}, null, 2));
fs.rmSync(dir, { recursive: true, force: true });
