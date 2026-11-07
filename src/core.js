/**
 * core.js —— 记忆图内核
 *
 * 三个跟主流方案不一样的设计：
 *   1. 锚点强制：每条 fact/plan 必须能指回原话（anchors[].quote），否则拒收。
 *      模型重写的摘要不可回溯 —— 这是本项目跟 Mem0/Zep 最大的分歧点。
 *   2. 四层衰减：instant → short → long → permanent；长期没动静会降冷，而不是永久堆积。
 *   3. 写入即去重：同 scope 内规范化文本相同 → 合并 mentionCount，而不是新建节点。
 */
import crypto from 'node:crypto';

export const LAYERS = ['instant', 'short', 'long', 'cold', 'permanent'];
export const KINDS = ['fact', 'impression', 'plan'];
export const CATEGORIES = ['preference', 'experience', 'relationship', 'plan', 'emotion', 'topic'];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const DEFAULTS = {
  minAnchors: { fact: 1, plan: 1, impression: 0 },
  dedupeWindowMs: 30 * DAY,
  promote: { minMentions: 3, minDays: 2 },
  coldAfterMs: 90 * DAY,
  maxTextLength: 2000,
  maxNodesPerWrite: 5,
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

/** 重要度：提过几次、被召回几次、有没有锚点、是不是规则类、多久没动静 */
export function importanceOf(node, now = Date.now()) {
  const mentions = Number(node.mentionCount || 0);
  const recalls = Number(node.recallCount || 0);
  const anchorBonus = Math.min(3, (node.anchors || []).length) * 0.15;
  const kindWeight = node.kind === 'fact' ? 0.3 : node.kind === 'plan' ? 0.2 : 0.1;
  const idle = Math.max(0, now - Number(node.lastTouchedAt || node.createdAt || now));
  const decay = Math.exp(-idle / (30 * DAY));
  return Number((mentions * 0.2 + recalls * 0.1 + anchorBonus + kindWeight + decay * 0.5).toFixed(4));
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

  /** 写入：校验锚点 → 去重合并 → 落盘 */
  write(scope, { nodes = [], writer = 'memory-graph' } = {}) {
    const s = scopeKey(scope);
    const at = this.now();
    const list = Array.isArray(nodes) ? nodes : [];
    if (list.length > this.options.maxNodesPerWrite) {
      throw new Error(`一次最多写 ${this.options.maxNodesPerWrite} 条`);
    }
    const existing = this.load(s);
    const byText = new Map(existing.filter((n) => !n.archived).map((n) => [normalizeText(n.text), n]));

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
      if (anchors.length < need) {
        throw new Error(`${kind} 至少需要 ${need} 条锚点（原话片段）`);
      }
      if (raw.category && !CATEGORIES.includes(raw.category)) throw new Error(`category 非法：${raw.category}`);

      const key = normalizeText(text);
      const prior = byText.get(key);
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
        category: raw.category ?? 'topic',
        layer: kind === 'fact' ? 'short' : kind === 'impression' ? 'short' : 'short',
        mentionCount: 1,
        recallCount: 0,
        importance: 0,
        writer,
        createdAt: at,
        updatedAt: at,
        lastTouchedAt: at,
        archived: false,
      };
      node.importance = importanceOf(node, at);
      this.store.append(s, node);
      byText.set(key, node);
      written.push(node);
    }
    return { written, merged, total: written.length + merged.length };
  }

  /** 召回：相似度 + 关键词 + 重要度 + 新鲜度；默认不返回冷层/归档/过期即时记忆 */
  recall(scope, { query = '', limit = 20, includeCold = false, includeArchived = false, now = this.now() } = {}) {
    const s = scopeKey(scope);
    const nodes = this.load(s).filter((n) => {
      if (!includeArchived && n.archived) return false;
      if (!includeCold && n.layer === 'cold') return false;
      if (n.layer === 'instant' && n.instantStatus === 'expired') return false;
      return true;
    });

    const scored = nodes.map((n) => {
      const sim = query ? similarity(query, n.text) : 0;
      const keywordHit = query && normalizeText(n.text).includes(normalizeText(query)) ? 0.4 : 0;
      const freshness = Math.exp(-Math.max(0, now - Number(n.lastTouchedAt || n.createdAt || now)) / (7 * DAY)) * 0.3;
      const score = sim * 2 + keywordHit + Number(n.importance || 0) * 0.5 + freshness;
      return { node: n, score };
    }).filter((x) => (query ? x.score > 0.05 : true));

    scored.sort((a, b) => b.score - a.score);
    const picked = scored.slice(0, limit);
    for (const x of picked) {
      const bumped = { ...x.node, recallCount: Number(x.node.recallCount || 0) + 1, updatedAt: now };
      bumped.importance = importanceOf(bumped, now);
      this.store.append(s, bumped);
    }
    return picked.map((x) => ({ ...x.node, score: Number(x.score.toFixed(3)) }));
  }

  /** 层状态机：short→long（满足提及次数+天数）、任意→cold（长期没动静） */
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
