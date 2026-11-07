/**
 * health.js —— 记忆体检（6 项）
 *
 * 单项指标没用，要能回答"这套记忆现在健不健康"。
 * 六项各有阈值，任何一项不达标都会点在 detail 里。
 */
import { normalizeText } from './core.js';

const DAY = 24 * 60 * 60 * 1000;

export function healthReport(memory, scope, { now = Date.now(), shared = null } = {}) {
  const all = memory.load(scope);
  const live = all.filter((n) => !n.archived);
  const archived = all.length - live.length;

  const byLayer = {};
  const byKind = {};
  let anchored = 0;
  let stale = 0;
  const textSeen = new Map();
  let dupes = 0;
  for (const n of live) {
    byLayer[n.layer || 'short'] = (byLayer[n.layer || 'short'] || 0) + 1;
    byKind[n.kind || '?'] = (byKind[n.kind || '?'] || 0) + 1;
    if ((n.anchors || []).length) anchored += 1;
    if (now - Number(n.lastTouchedAt || n.createdAt || 0) > 90 * DAY) stale += 1;
    const k = normalizeText(n.text);
    if (!k) continue;
    const seen = textSeen.get(k) || 0;
    if (seen > 0) dupes += 1;
    textSeen.set(k, seen + 1);
  }

  const anchorRatio = live.length ? anchored / live.length : 0;
  const dupRatio = live.length ? dupes / live.length : 0;
  const staleRatio = live.length ? stale / live.length : 0;
  const archivedRatio = all.length ? archived / all.length : 0;
  const longRatio = live.length ? ((byLayer.long || 0) + (byLayer.permanent || 0)) / live.length : 0;
  const instantRatio = live.length ? (byLayer.instant || 0) / live.length : 0;
  let sharedPending = 0;
  try { sharedPending = shared ? shared.list({ status: 'proposed' }).length : 0; } catch { sharedPending = 0; }

  const checks = [
    {
      name: '锚点覆盖率',
      ok: live.length === 0 || anchorRatio >= 0.6,
      value: Number(anchorRatio.toFixed(3)),
      detail: `${anchored}/${live.length} 条有原话锚点（建议 ≥60%）`,
    },
    {
      name: '重复率',
      ok: dupRatio <= 0.1,
      value: Number(dupRatio.toFixed(3)),
      detail: `${dupes} 条重复文本（建议 ≤10%，夜间整理会归档）`,
    },
    {
      name: '长期记忆占比',
      ok: live.length === 0 || longRatio >= 0.1,
      value: Number(longRatio.toFixed(3)),
      detail: `long+permanent ${((byLayer.long || 0) + (byLayer.permanent || 0))} 条（建议 ≥10%，太少说明没沉淀）`,
    },
    {
      name: '即时记忆占比',
      ok: live.length === 0 || instantRatio <= 0.4,
      value: Number(instantRatio.toFixed(3)),
      detail: `instant ${byLayer.instant || 0} 条（建议 ≤40%，太多说明没被整理）`,
    },
    {
      name: '陈旧度',
      ok: live.length === 0 || staleRatio <= 0.5,
      value: Number(staleRatio.toFixed(3)),
      detail: `${stale} 条超过 90 天没动静（建议 ≤50%）`,
    },
    {
      name: '归档与共享',
      ok: archivedRatio <= 0.7 && sharedPending <= 5,
      value: Number(archivedRatio.toFixed(3)),
      detail: `归档 ${archived}/${all.length}；待批准共享 ${sharedPending} 条`,
    },
  ];

  return {
    scope,
    at: new Date(now).toISOString(),
    total: all.length,
    live: live.length,
    archived,
    byLayer,
    byKind,
    checks,
    ok: checks.every((c) => c.ok),
    failed: checks.filter((c) => !c.ok).map((c) => c.name),
  };
}
