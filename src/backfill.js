/**
 * backfill.js —— 补录协议
 *
 * 为什么单独一套规则：
 *   正常写入是"现在看到什么记什么"；补录是"从旧材料里往回捞"，最容易编。
 *   所以补录比正常写入严得多：
 *     · 只允许 fact（不许印象、不许计划）
 *     · 一次最多 2 条
 *     · 必须带证据 { quote, source, sourceTime }，source 只能是 旧记忆/日记/核心记忆
 *     · 整批原子：一条不合格，这批全拒
 *     · 权重 0.8（召回时打折，避免补录顶掉真实经历）
 */
import { hashId } from './core.js';

export const BACKFILL_SOURCES = ['旧记忆', '日记', '核心记忆'];
export const BACKFILL_WEIGHT = 0.8;
export const BACKFILL_MAX = 2;

export function validateBackfill({ nodes = [], evidence = null } = {}) {
  const errors = [];
  const list = Array.isArray(nodes) ? nodes : [];
  if (!list.length) errors.push('没有要补录的节点');
  if (list.length > BACKFILL_MAX) errors.push(`一次最多补录 ${BACKFILL_MAX} 条`);
  for (const n of list) {
    if (n?.kind !== 'fact') errors.push(`补录只允许 fact（收到 ${n?.kind}）`);
  }
  if (!evidence || typeof evidence !== 'object') {
    errors.push('缺少 evidence');
  } else {
    if (!String(evidence.quote || '').trim()) errors.push('evidence.quote 不能为空');
    if (!BACKFILL_SOURCES.includes(String(evidence.source || '').trim())) {
      errors.push(`evidence.source 只能是：${BACKFILL_SOURCES.join(' / ')}`);
    }
    if (!String(evidence.sourceTime || '').trim()) errors.push('evidence.sourceTime 不能为空');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 补录并落盘（原子）：先全部校验，再一次性写。
 * @returns {{ok:boolean, errors?:string[], written?:Array, weight?:number}}
 */
export function backfill(graph, scope, { nodes = [], evidence = null, writer = 'backfill' } = {}) {
  const check = validateBackfill({ nodes, evidence });
  if (!check.ok) return { ok: false, errors: check.errors };

  const at = Date.now();
  const prepared = nodes.map((n) => ({
    kind: 'fact',
    text: String(n.text || '').trim().slice(0, 200),
    category: n.category || 'experience',
    cluster: 'backfill',
    anchors: (n.anchors && n.anchors.length)
      ? n.anchors
      : [{ quote: String(evidence.quote).slice(0, 200), source: evidence.source, at }],
    origin: 'backfill',
    originWeight: BACKFILL_WEIGHT,
    backfillEvidence: {
      quote: String(evidence.quote).slice(0, 500),
      source: String(evidence.source),
      sourceTime: String(evidence.sourceTime).slice(0, 60),
    },
  }));

  // 整批一次写；任何一条失败就整体回滚（这里靠"先校验再写"保证原子性）
  const result = graph.write(scope, { nodes: prepared, writer });
  return { ok: true, written: result.written, merged: result.merged, weight: BACKFILL_WEIGHT };
}
