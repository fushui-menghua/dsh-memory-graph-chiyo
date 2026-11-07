#!/usr/bin/env node
/**
 * cli.mjs —— 命令行入口
 *
 *   node bin/cli.mjs health   --dir ./data --scope user:alice
 *   node bin/cli.mjs recall   --dir ./data --scope user:alice --query 下雨
 *   node bin/cli.mjs nightly  --dir ./data --scopes user:alice,agent:chiyo [--apply]
 *   node bin/cli.mjs shared-list --dir ./data
 *   node bin/cli.mjs shared-approve --dir ./data --id s_xxx --by owner
 */
import fs from 'node:fs';
import { createMemory } from '../src/index.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const dir = String(args.dir ?? './memory-data');
const memory = createMemory({ dir });
const scope = args.scope ? String(args.scope) : null;
const scopes = args.scopes ? String(args.scopes).split(',').map((s) => s.trim()).filter(Boolean) : (scope ? [scope] : []);

if (!cmd) {
  console.log('用法: cli.mjs <health|recall|recall-all|tick|consolidate|nightly|shared-list|shared-approve|shared-revoke> [--dir ...] [--scope ...] [--query ...] [--apply]');
  process.exit(0);
}
if (!scope && !['nightly', 'shared-list', 'shared-approve', 'shared-revoke', 'scan', 'repair'].includes(cmd)) {
  console.error('缺少 --scope（或命令不适用）');
  process.exit(1);
}

switch (cmd) {
  case 'health': {
    console.log(JSON.stringify(memory.health(scope), null, 2));
    break;
  }
  case 'recall': {
    const hits = memory.recall(scope, { query: String(args.query ?? ''), limit: Number(args.limit ?? 10), includeCold: args.cold === true });
    for (const h of hits) console.log(`[${h.kind}/${h.layer}] ${h.text}  (score ${h.score})`);
    if (!hits.length) console.log('（没有命中）');
    break;
  }
  case 'recall-all': {
    const hits = memory.recallAcross(scopes.length ? scopes : [scope], { query: String(args.query ?? ''), limit: Number(args.limit ?? 15) });
    for (const h of hits) console.log(`[${h.scope}] [${h.kind}/${h.layer}] ${h.text}  (score ${h.score})`);
    if (!hits.length) console.log('（没有命中）');
    break;
  }
  case 'tick': {
    const changes = memory.tickLayers(scope, { apply: args.apply === true });
    console.log(`层变化 ${changes.length} 条${args.apply ? '（已写入）' : '（dry-run）'}`);
    for (const c of changes) console.log(`  ${c.from} → ${c.to}  ${c.text}`);
    break;
  }
  case 'consolidate': {
    const r = memory.consolidate(scope, { apply: args.apply === true });
    console.log(JSON.stringify({ scope: r.scope, total: r.total, archived: r.archived, reinforced: r.reinforced, apply: r.apply }, null, 2));
    break;
  }
  case 'galaxy': {
    const out = String(args.out ?? 'memory-galaxy.html');
    const html = memory.galaxyHtml(memory.load(scope), { title: args.title ? String(args.title) : '记忆星图', scope });
    fs.writeFileSync(out, html, 'utf8');
    console.log('已导出交互式星图:', out, '（双击用浏览器打开）');
    break;
  }
  case 'scan': {
    console.log(JSON.stringify(memory.scanStore({ dir }), null, 2));
    break;
  }
  case 'repair': {
    console.log(JSON.stringify(memory.repairStore({ dir, apply: args.apply === true }), null, 2));
    break;
  }
  case 'nightly': {
    const r = memory.nightly(scopes, { apply: args.apply === true });
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case 'shared-list': {
    const rows = memory.listShared({ status: String(args.status ?? '') });
    for (const e of rows) console.log(`[${e.status}] ${e.id}  ${e.text.slice(0, 60)}  (from ${e.sourceScope})`);
    if (!rows.length) console.log('（没有共享记忆）');
    break;
  }
  case 'shared-approve': {
    const e = memory.approveShared(String(args.id), { by: String(args.by ?? 'owner') });
    console.log(`已批准：${e.id}  ${e.text.slice(0, 60)}`);
    break;
  }
  case 'shared-revoke': {
    const e = memory.revokeShared(String(args.id), { by: String(args.by ?? 'owner'), reason: String(args.reason ?? '') });
    console.log(`已撤销：${e.id}`);
    break;
  }
  default:
    console.error(`未知命令：${cmd}`);
    process.exit(1);
}
