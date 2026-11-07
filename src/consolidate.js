/**
 * consolidate.js —— 夜间整理：收起没用的，把重要的往前挪
 *
 * 这是本项目跟"向量库 + 摘要"方案最不一样的地方：
 * 记忆不是只增不减的仓库，而是每晚会被重新权衡的活体。
 *
 * 规则（默认只 dry-run，--apply 才动）：
 *   清：重复 / 墓碑 / 极短陈旧
 *   强：提过≥3次、召回≥5次、规则承诺类 → 升 long
 */
import { importanceOf, normalizeText } from './core.js';

const DAY = 24 * 60 * 60 * 1000;

export function consolidate(graph, scope, { apply = false, now = Date.now(), options = {} } = {}) {
  const opts = {
    tinyStaleDays: 14,
    tinyLen: 10,
    maxRecallsForReinforce: 5,
    ...options,
  };
  const nodes = graph.load(scope).filter((n) => !n.archived);
  const archive = [];
  const reinforce = [];

  // 1) 按规范化文本分组，重复的留最有用的一条
  const groups = new Map();
  for (const n of nodes) {
    if (!n.text) continue;
    const k = normalizeText(n.text);
    const arr = groups.get(k) || [];
    arr.push(n);
    groups.set(k, arr);
  }
  const keepIds = new Set();
  const lastTouch = (n) => Number(n.lastTouchedAt || n.updatedAt || n.createdAt || 0);
  for (const [, arr] of groups) {
    if (arr.length <= 1) continue;
    const best = arr.slice().sort((a, b) =>
      (Number(b.mentionCount || 0) - Number(a.mentionCount || 0))
      || (lastTouch(b) - lastTouch(a))
      || (Number(b.importance || 0) - Number(a.importance || 0)))[0];
    for (const n of arr) {
      if (n.id === best.id) continue;
      archive.push({ id: n.id, why: 'duplicate', text: n.text.slice(0, 60) });
      keepIds.add(n.id);
    }
  }

  // 2) 墓碑、极短陈旧
  for (const n of nodes) {
    if (keepIds.has(n.id)) continue;
    const isTomb = n.kind === 'instant' && n.instantStatus === 'expired';
    const tiny = String(n.text || '').trim().length < opts.tinyLen
      && !(n.anchors || []).length
      && Number(n.mentionCount || 0) <= 1
      && now - lastTouch(n) > opts.tinyStaleDays * DAY;
    if (isTomb) archive.push({ id: n.id, why: 'tombstone', text: n.text.slice(0, 60) });
    else if (tiny && (n.layer || 'short') === 'short') archive.push({ id: n.id, why: 'tiny-stale', text: n.text.slice(0, 60) });
  }

  // 3) 强化
  for (const n of nodes) {
    if (keepIds.has(n.id)) continue;
    const layer = n.layer || 'short';
    if (!['short', ''].includes(layer)) continue;
    const mentions = Number(n.mentionCount || 0);
    const recalls = Number(n.recallCount || 0);
    const ruleish = /规则|承诺|决定|边界|不许|不准|以后/.test(String(n.text || ''));
    if (mentions >= 3 || recalls >= opts.maxRecallsForReinforce || ruleish) {
      reinforce.push({ id: n.id, text: n.text.slice(0, 60) });
    }
  }

  const report = {
    scope,
    at: new Date(now).toISOString(),
    apply,
    total: nodes.length,
    archived: archive.length,
    reinforced: reinforce.length,
    archive,
    reinforce,
  };

  if (apply) {
    const touched = new Set();
    for (const a of archive) {
      const node = nodes.find((n) => n.id === a.id);
      if (!node) continue;
      graph.store.append(scope, { ...node, archived: true, archivedAt: now, archiveReason: `consolidate:${a.why}`, updatedAt: now });
      touched.add(node.id);
    }
    for (const r of reinforce) {
      const node = nodes.find((n) => n.id === r.id);
      if (!node) continue;
      const updated = { ...node, layer: 'long', updatedAt: now, layerChangedAt: now };
      updated.importance = importanceOf(updated, now);
      graph.store.append(scope, updated);
      touched.add(node.id);
    }
    report.touched = touched.size;
  }

  return report;
}

/** 记忆体检：给一眼能看的健康度 */
export function health(graph, scope, { now = Date.now() } = {}) {
  const all = graph.load(scope);
  const live = all.filter((n) => !n.archived);
  const byLayer = {};
  const byKind = {};
  let anchored = 0;
  let stale = 0;
  for (const n of live) {
    byLayer[n.layer || 'short'] = (byLayer[n.layer || 'short'] || 0) + 1;
    byKind[n.kind || '?'] = (byKind[n.kind || '?'] || 0) + 1;
    if ((n.anchors || []).length) anchored += 1;
    if (now - Number(n.lastTouchedAt || n.createdAt || 0) > 90 * DAY) stale += 1;
  }
  return {
    scope,
    total: all.length,
    live: live.length,
    archived: all.length - live.length,
    byLayer,
    byKind,
    anchoredRatio: live.length ? Number((anchored / live.length).toFixed(3)) : 0,
    staleOver90d: stale,
  };
}
