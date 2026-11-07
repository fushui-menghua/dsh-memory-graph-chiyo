/**
 * plugin.js —— DSH 插件入口（把记忆库包成能装进 DSH 的插件）
 *
 * 同一个包两种用法：
 *   1. 库：import { createMemory } from 'dsh-memory-graph-chiyo'
 *   2. 插件：在 DSH profile 里列出本包，cordis 会调这里的 apply(ctx)
 *
 * 插件注册 5 个工具，够用又不撑爆工具表：
 *   memory_write   写一条记忆（带锚点）
 *   memory_recall  召回
 *   memory_health  体检
 *   memory_nightly 夜间整理（默认 dry-run）
 *   memory_shared  共享记忆（list / propose / approve / revoke）
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createMemory } from './src/index.js';

// ── defineTool：宿主给了就用宿主的，没给就用本地兜底（照抄 toolkit 的思路）──
let base = (spec) => spec;
let usingHost = false;
try {
  const m = await import('dsh-tools');
  if (typeof m.defineTool === 'function') { base = m.defineTool; usingHost = true; }
} catch { /* 宿主没暴露就用本地兜底 */ }

export const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
};

export function toJsonSchema(params) {
  if (!params) return { type: 'object', properties: {}, required: [] };
  if (params.type === 'object') return params;
  const props = {};
  const required = [];
  for (const [key, val] of Object.entries(params)) {
    if (!val || typeof val !== 'object') continue;
    const { required: isRequired, ...schema } = val;
    props[key] = schema;
    if (isRequired === true) required.push(key);
  }
  return { type: 'object', properties: props, required, additionalProperties: false };
}

function defineTool(spec) {
  if (usingHost) return base({ output: textOutput, ...spec });
  return base({ output: textOutput, ...spec, parameters: toJsonSchema(spec.parameters) });
}

export const name = 'memory-graph';

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dir = path.resolve(config.dir || path.join(home, 'memory-graph'));
  const defaultScope = String(config.scope || 'agent:memory');
  fs.mkdirSync(dir, { recursive: true });
  const mem = createMemory({ dir });
  const scopeOf = (s) => String(s || defaultScope);

  const tools = [
    {
      name: 'memory_write',
      description: '写一条长期记忆。fact/plan 必须带原话锚点（anchors.quote）。同一件事重复写会自动合并。',
      parameters: {
        kind: { type: 'string', enum: ['fact', 'impression', 'plan'], required: true, description: '记忆类型' },
        text: { type: 'string', required: true, description: '一句话陈述' },
        anchors: { type: 'array', items: { type: 'object' }, description: '原话片段，如 [{quote:"我最喜欢下雨了"}]' },
        category: { type: 'string', description: 'preference/experience/relationship/plan/emotion/topic' },
        scope: { type: 'string', description: `记忆分区，默认 ${defaultScope}` },
      },
      execute: async (args = {}) => {
        const r = mem.write(scopeOf(args.scope), {
          nodes: [{ kind: args.kind, text: args.text, anchors: args.anchors || [], category: args.category }],
        });
        return { written: r.written.length, merged: r.merged.length, id: r.written[0]?.id };
      },
    },
    {
      name: 'memory_recall',
      description: '按关键词/相似度召回长期记忆，返回带 id 的条目。',
      parameters: {
        query: { type: 'string', description: '想找什么' },
        limit: { type: 'number', description: '最多几条，默认 10' },
        scope: { type: 'string', description: `记忆分区，默认 ${defaultScope}` },
      },
      execute: async (args = {}) => {
        const hits = mem.recall(scopeOf(args.scope), { query: args.query || '', limit: Number(args.limit) || 10 });
        return hits.map((h) => ({ id: h.id, kind: h.kind, layer: h.layer, text: h.text, score: h.score }));
      },
    },
    {
      name: 'memory_health',
      description: '记忆体检：锚点覆盖率、重复率、分层占比、陈旧度等六项。',
      parameters: { scope: { type: 'string', description: `记忆分区，默认 ${defaultScope}` } },
      execute: async (args = {}) => mem.healthReport({ scope: scopeOf(args.scope) }),
    },
    {
      name: 'memory_nightly',
      description: '夜间整理：推进层与即时记忆、归档噪声、强化重要记忆。默认 dry-run，apply=true 才真改。',
      parameters: {
        scope: { type: 'string', description: `记忆分区，默认 ${defaultScope}` },
        apply: { type: 'boolean', description: 'true 才真正写入，默认只报告' },
      },
      execute: async (args = {}) => mem.nightly([scopeOf(args.scope)], { apply: args.apply === true }),
    },
    {
      name: 'memory_shared',
      description: '共享记忆：list 列出、propose 提名、approve 批准、revoke 撤销。只有 approved 能被其他会话召回。',
      parameters: {
        action: { type: 'string', enum: ['list', 'propose', 'approve', 'revoke'], required: true },
        id: { type: 'string', description: '条目 id（approve/revoke 用）' },
        text: { type: 'string', description: '提名内容（propose 用）' },
        sourceScope: { type: 'string', description: '来源分区（propose 用）' },
        by: { type: 'string', description: '操作人，默认 plugin' },
      },
      execute: async (args = {}) => {
        const by = String(args.by || 'plugin');
        if (args.action === 'list') return mem.listShared({ status: args.status || '' });
        if (args.action === 'propose') return mem.proposeShared({ text: args.text, sourceScope: scopeOf(args.sourceScope), by });
        if (args.action === 'approve') return mem.approveShared(args.id, { by });
        if (args.action === 'revoke') return mem.revokeShared(args.id, { by });
        throw new Error(`未知 action：${args.action}`);
      },
    },
  ];

  let registered = 0;
  for (const spec of tools) {
    try {
      ctx.tools.register(defineTool(spec));
      registered += 1;
    } catch (e) {
      // 单个工具没注册上不影响别的
      try { ctx.logger?.warn?.(`[memory-graph] 工具 ${spec.name} 注册失败：${e?.message ?? e}`); } catch {}
    }
  }
  try { ctx.logger?.info?.(`[memory-graph] 已挂载 ${registered}/${tools.length} 个工具，数据目录 ${dir}，默认分区 ${defaultScope}`); } catch {}
  return { dir, defaultScope, registered };
}

export default apply;
