/**
 * core.js —— 记忆图内核（v0.2.0）
 *
 * 设计要点：
 *   1. 锚点强制：fact/plan 必须能指回原话，否则拒收。
 *   2. 四层衰减：instant → short → long → cold；长期没动静降冷，不是只增不减。
 *   3. 写入即去重：规范化文本相同 → 合并 mentionCount。
 *   4. 关系边：person/relationship/because/derivedFrom/supports/contradicts。
 *   5. plan 生命周期：active 有 validTo，过期自动 expired。
 *   6. 跨 scope 召回：多 scope 合并打分，带来源标记。
 */
import crypto from 'node:crypto';
import { assertNotSensitive } from './sensitive.js';
import { findMissingAnchors } from './anchor.js';

export const LAYERS = ['instant', 'short', 'long', 'cold', 'permanent'];
export const KINDS = ['fact', 'impression', 'plan'];
export const CATEGORIES = ['preference', 'experience', 'relationship', 'plan', 'emotion', 'topic'];
export const REL_TYPES = ['person', 'relationship', 'because', 'derivedFrom', 'supports', 'contradicts'];
export const PLAN_STATUSES = ['active', 'done', 'abandoned', 'expired'];

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULTS = {
  minAnchors: { fact: 1, plan: 1, impression: 0 },
  promote: { minMentions: 3, minDays: 2 },
  coldAfterMs: 90 * DAY,
  maxTextLength: 2000,
  maxNodesPerWrite: 5,
  planDefaultDays: 7,
};

export function hashId(prefix = 'n') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）()【】\[\]{}<>《》~…—\-]/g, '');
}

export function bigrams(text) {
  const s = normalizeText(text);
  const out = new Set();
  if (s.length < 2) { if (s) out.add(s); return out; }
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

export function similarity(query, text) {
  const a = bigrams(query);
  const b = bigrams(text);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return hit / Math.sqrt(a.size * b.size);
}

export function scopeKey(scope) {
  const s = String(scope ?? '');
  if (!/^[a-z][a-z0-9_-]*:[A-Za-z0-9_.-]{1,64}$/i.test(s)) {
    throw new Error(`scope 格式非法：${s}（应形如 user:alice / agent:chiyo）`);
  }
  return s;
}

export function importanceOf(node, now = Date.now()) {
  const mentions = Number(node.mentionCount || 0);
  const recalls = Number(node.recallCount || 0);
  const anchorBonus = Math.min(3, (node.anchors || []).length) * 0.15;
  const kindWeight = node.kind === 'fact' ? 0.3 : node.kind === 'plan' ? 0.2 : 0.1;
  const idle = Math.max(0, now - Number(node.lastTouchedAt || node.createdAt || now));
  const decay = Math.exp(-idle / (30 * DAY));
  return Number((mentions * 0.2 + recalls * 0.1 + anchorBonus + kindWeight + decay * 0.5).toFixed(4));
}

function relevanceOf(node, query) {
  if (!query) return { sim: 0, keywordHit: 0, relevant: true };
  const sim = similarity(query, node.text);
  const keywordHit = normalizeText(node.text).includes(normalizeText(query)) ? 0.4 : 0;
  return { sim, keywordHit, relevant: sim > 0 || keywordHit > 0 };
}

function scoreNode(node, query, now) {
  const { sim, keywordHit } = relevanceOf(node, query);
  const freshness = Math.exp(-Math.max(0, now - Number(node.lastTouchedAt || node.createdAt || now)) / (7 * DAY)) * 0.3;
  return sim * 2 + keywordHit + Number(node.importance || 0) * 0.5 + freshness;
}

export class MemoryGraph {
  constructor({ store, options = {}, clock } = {}) {
    if (!store) throw new Error('MemoryGraph 需要 store');
    this.store = store;
    this.options = { ...DEFAULTS, ...options };
    this.clock = clock || (() => Date.now());
  }

  now() { return Number(this.clock()); }

  load(scope) { return this.store.load(scopeKey(scope)); }

  /** 写入：锚点校验 → 关系边校验 → 去重合并 → 落盘 */
  write(scope, { nodes = [], writer = 'memory-graph', messages = null, allowSensitive = false, sensitiveAllow = [] } = {}) {
    const s = scopeKey(scope);
    const at = this.now();
    const list = Array.isArray(nodes) ? nodes : [];
    if (list.length > this.options.maxNodesPerWrite) {
      throw new Error(`一次最多写 ${this.options.maxNodesPerWrite} 条`);
    }
    const existing = this.load(s);
    const alive = existing.filter((n) => !n.archived);
    const byText = new Map(alive.map((n) => [normalizeText(n.text), n]));
    const byKey = new Map();
    for (const x of alive) {
      if (x.idempotencyKey) byKey.set(`id:${x.idempotencyKey}`, x);
      if (x.mentionKey) byKey.set(`m:${x.mentionKey}`, x);
    }
    const idSet = new Set(alive.map((n) => n.id));

    const written = [];
    const merged = [];
    for (const raw of list) {
      const kind = raw.kind;
      if (!KINDS.includes(kind)) throw new Error(`kind 非法：${kind}`);
      const text = String(raw.text ?? '').trim().slice(0, this.options.maxTextLength);
      if (text.length < 2) throw new Error('text 太短');
      const anchors = (raw.anchors || [])
        .map((a) => ({ quote: String(a?.quote ?? '').trim().slice(0, 200), source: a?.source ? String(a.source) : undefined, at: a?.at }))
        .filter((a) => a.quote);
      const need = this.options.minAnchors[kind] ?? 0;
      if (anchors.length < need) throw new Error(`${kind} 至少需要 ${need} 条锚点（原话片段）`);
      // 强校验：给了原始消息，锚点就必须真的出现在里面（防模型编引文）
      if (messages && anchors.length) {
        const missing = findMissingAnchors(anchors, messages);
        if (missing.length) {
          const err = new Error(`锚点在原文里找不到：${missing.join(' / ')}`);
          err.code = 'ANCHOR_NOT_FOUND';
          err.missing = missing;
          throw err;
        }
      }
      // 敏感内容：路径/QQ号/凭据默认拒收，避免永久落盘
      if (!allowSensitive) assertNotSensitive(text, { allow: sensitiveAllow });
      if (raw.category && !CATEGORIES.includes(raw.category)) throw new Error(`category 非法：${raw.category}`);

      const relations = (raw.relations || []).map((r) => {
        if (!REL_TYPES.includes(r?.type)) throw new Error(`关系类型非法：${r?.type}`);
        if (!r?.targetId) throw new Error('关系缺少 targetId');
        if (!idSet.has(r.targetId)) throw new Error(`关系指向不存在的节点：${r.targetId}`);
        return { type: r.type, targetId: String(r.targetId) };
      });

      const key = normalizeText(text);
      const keyId = raw.idempotencyKey ? `id:${raw.idempotencyKey}` : null;
      const keyMention = raw.mentionKey ? `m:${raw.mentionKey}` : null;
      const prior = (keyId && byKey.get(keyId)) || (keyMention && byKey.get(keyMention)) || byText.get(key);
      if (prior) {
        const updated = {
          ...prior,
          mentionCount: Number(prior.mentionCount || 1) + 1,
          lastTouchedAt: at,
          updatedAt: at,
        };
        this.store.append(s, updated);
        byText.set(key, updated);
        merged.push({ id: updated.id, text: updated.text, mentionCount: updated.mentionCount });
        continue;
      }

      const node = {
        id: hashId(),
        scope: s,
        kind,
        text,
        anchors,
        relations,
        category: raw.category ?? (kind === 'plan' ? 'plan' : 'topic'),
        layer: 'short',
        mentionCount: 1,
        recallCount: 0,
        importance: 0,
        writer,
        createdAt: at,
        updatedAt: at,
        lastTouchedAt: at,
        archived: false,
      };
      if (raw.idempotencyKey) node.idempotencyKey = String(raw.idempotencyKey);
      if (raw.mentionKey) node.mentionKey = String(raw.mentionKey);
      if (kind === 'plan') {
        node.status = 'active';
        const days = Number(raw.validDays ?? this.options.planDefaultDays);
        node.validTo = Number(raw.validTo ?? (at + days * DAY));
      }
      node.importance = importanceOf(node, at);
      this.store.append(s, node);
      byText.set(key, node);
      idSet.add(node.id);
      written.push(node);
    }
    return { written, merged, total: written.length + merged.length };
  }

  _visible(nodes, { includeCold = false, includeArchived = false, now }) {
    return nodes.filter((n) => {
      if (!includeArchived && n.archived) return false;
      if (!includeCold && n.layer === 'cold') return false;
      if (n.layer === 'instant' && n.instantStatus === 'expired') return false;
      if (n.kind === 'plan' && n.status && n.status !== 'active') return false;
      if (n.kind === 'plan' && n.status === 'active' && n.validTo && Number(n.validTo) < now) return false;
      return true;
    });
  }

  /** 单 scope 召回；hops>0 时沿关系边扩展一跳 */
  recall(scope, { query = '', limit = 20, includeCold = false, includeArchived = false, hops = 0 } = {}) {
    const s = scopeKey(scope);
    const now = this.now();
    const all = this.load(s);
    const picked = this._rank(all, { query, limit, includeCold, includeArchived, now });

    let expanded = [];
    if (hops > 0 && picked.length) {
      const ids = new Set(picked.map((x) => x.node.id));
      const extra = [];
      for (const p of picked) {
        // 出边：这个节点指向别人
        for (const rel of p.node.relations || []) {
          if (ids.has(rel.targetId)) continue;
          const target = all.find((n) => n.id === rel.targetId);
          if (!target) continue;
          ids.add(target.id);
          extra.push({ node: target, score: p.score * 0.6, via: p.node.id, rel: rel.type });
        }
        // 入边：别人指向这个节点（"她怕黑" ← "睡觉要留一盏小灯"）
        for (const n of all) {
          if (ids.has(n.id)) continue;
          const rel = (n.relations || []).find((r) => r.targetId === p.node.id);
          if (!rel) continue;
          ids.add(n.id);
          extra.push({ node: n, score: p.score * 0.5, via: p.node.id, rel: rel.type });
        }
      }
      expanded = extra;
    }

    const chosen = [...picked, ...expanded].slice(0, limit);
    for (const x of chosen) {
      const bumped = { ...x.node, recallCount: Number(x.node.recallCount || 0) + 1, updatedAt: now };
      bumped.importance = importanceOf(bumped, now);
      this.store.append(s, bumped);
    }
    return chosen.map((x) => ({ ...x.node, score: Number(x.score.toFixed(3)), ...(x.via ? { via: x.via, relation: x.rel } : {}) }));
  }

  _rank(nodes, { query, limit, includeCold, includeArchived, now }) {
    const visible = this._visible(nodes, { includeCold, includeArchived, now });
    return visible
      .map((n) => ({ node: n, score: scoreNode(n, query, now), relevant: relevanceOf(n, query).relevant }))
      // 有查询时，只留下"真的跟查询有点关系"的节点；否则重要度和新鲜度会让所有节点都通过
      .filter((x) => (query ? x.relevant && x.score > 0.05 : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** 跨 scope 召回：多 scope 合并打分，结果带 scope 来源 */
  recallAcross(scopes, { query = '', limit = 20, perScopeLimit = 10, includeCold = false } = {}) {
    const now = this.now();
    const merged = [];
    for (const raw of scopes) {
      const s = scopeKey(raw);
      const ranked = this._rank(this.load(s), { query, limit: perScopeLimit, includeCold, now });
      for (const r of ranked) merged.push({ ...r, scope: s });
    }
    merged.sort((a, b) => b.score - a.score);
    const top = merged.slice(0, limit);
    // 只对最终选中的节点回写 recallCount，避免跨 scope 检索把无关 scope 的记忆全炒热
    for (const t of top) {
      const bumped = { ...t.node, recallCount: Number(t.node.recallCount || 0) + 1, updatedAt: now };
      bumped.importance = importanceOf(bumped, now);
      this.store.append(t.scope, bumped);
    }
    return top.map((t) => ({ ...t.node, scope: t.scope, score: Number(t.score.toFixed(3)) }));
  }

  /** plan 生命周期：到期的 active 计划自动 expired */
  tickPlans(scope, { now = this.now(), apply = true } = {}) {
    const s = scopeKey(scope);
    const nodes = this.load(s).filter((n) => n.kind === 'plan' && !n.archived && n.status === 'active');
    const expired = [];
    for (const n of nodes) {
      if (!n.validTo || Number(n.validTo) >= now) continue;
      const updated = { ...n, status: 'expired', updatedAt: now, expiredAt: now };
      if (apply) this.store.append(s, updated);
      expired.push({ id: n.id, text: n.text.slice(0, 40) });
    }
    return expired;
  }

  /** 手动结束/放弃一个计划 */
  setPlanStatus(scope, id, status, reason = '') {
    const s = scopeKey(scope);
    if (!PLAN_STATUSES.includes(status)) throw new Error(`plan 状态非法：${status}`);
    const node = this.load(s).find((n) => n.id === id && n.kind === 'plan');
    if (!node) throw new Error('计划不存在');
    const at = this.now();
    const updated = { ...node, status, updatedAt: at, statusReason: String(reason).slice(0, 200) };
    this.store.append(s, updated);
    return updated;
  }

  /** 层状态机：short→long / →cold */
  tick(scope, { now = this.now(), apply = true } = {}) {
    const s = scopeKey(scope);
    const nodes = this.load(s);
    const { minMentions, minDays } = this.options.promote;
    const changes = [];
    for (const n of nodes) {
      if (n.archived) continue;
      const layer = n.layer || 'short';
      const idle = now - Number(n.lastTouchedAt || n.createdAt || now);
      const age = now - Number(n.createdAt || now);
      let next = null;
      if (layer === 'short' && Number(n.mentionCount || 0) >= minMentions && age >= minDays * DAY) next = 'long';
      else if (layer === 'short' && idle >= this.options.coldAfterMs) next = 'cold';
      else if (layer === 'long' && idle >= this.options.coldAfterMs * 2) next = 'cold';
      if (!next) continue;
      const updated = { ...n, layer: next, updatedAt: now, layerChangedAt: now };
      if (apply) this.store.append(s, updated);
      changes.push({ id: n.id, from: layer, to: next, text: n.text.slice(0, 40) });
    }
    return changes;
  }
}
