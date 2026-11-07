/**
 * timeline.js —— 时段轨迹 + 漏检扫描
 *
 * 时段轨迹（episode）：把某段时间里的记忆节点汇总成"那段时间发生了什么"，
 * 用于隔天回看、也用于给夜间整理提供上下文。
 *
 * 漏检扫描（missed-scan）：反向查——哪些说过的话没有被任何锚点引用过，
 * 说明可能漏记了。不是自动补记，只给清单，避免模型自己编。
 */
const HOUR = 60 * 60 * 1000;

export function buildEpisode(memory, { scope, from = Date.now() - 24 * HOUR, to = Date.now() } = {}) {
  const nodes = memory.load(scope).filter((n) => {
    const at = Number(n.createdAt || n.updatedAt || 0);
    return at >= from && at <= to;
  });
  const byKind = {};
  const byCategory = {};
  for (const n of nodes) {
    byKind[n.kind || '?'] = (byKind[n.kind || '?'] || 0) + 1;
    byCategory[n.category || 'topic'] = (byCategory[n.category || 'topic'] || 0) + 1;
  }
  const highlights = nodes
    .filter((n) => (n.anchors || []).length)
    .slice(-8)
    .map((n) => ({ id: n.id, text: String(n.text).slice(0, 80), layer: n.layer }));

  return {
    scope,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    total: nodes.length,
    byKind,
    byCategory,
    highlights,
  };
}

/** 哪些消息没有被任何锚点引用过（可能漏记） */
export function missedScan(memory, { scope, messages = [] } = {}) {
  const nodes = memory.load(scope).filter((n) => !n.archived);
  const quotes = [];
  for (const n of nodes) for (const a of n.anchors || []) if (a?.quote) quotes.push(String(a.quote));
  const norm = (s) => String(s ?? '').replace(/[\s\u3000]+/g, '').toLowerCase();
  const quoted = quotes.map(norm);

  const missed = [];
  for (const m of messages) {
    const text = typeof m === 'string' ? m : (m?.text ?? m?.content ?? '');
    const t = norm(text);
    if (!t || t.length < 8) continue;
    const covered = quoted.some((q) => q && t.includes(q));
    if (!covered) missed.push({ id: m?.id, text: String(text).slice(0, 100) });
  }
  return { scope, scanned: messages.length, missed };
}
