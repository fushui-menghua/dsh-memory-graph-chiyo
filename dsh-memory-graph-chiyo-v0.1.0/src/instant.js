/**
 * instant.js —— 即时记忆：醒着 6 小时，睡着 6 小时，死了留一句墓碑
 *
 * 跟 short/long 的区别：即时记忆不需要锚点（它记录的是"这段时间发生了什么"），
 * 靠 topicKey/eventKey 精确复活；连续复活 3 次才升级成真正的 fact。
 */
import { hashId, normalizeText } from './core.js';

const HOUR = 60 * 60 * 1000;

export const INSTANT_DEFAULTS = {
  awakeMs: 6 * HOUR,
  sleepMs: 6 * HOUR,
  revivesToPromote: 3,
  tombstoneText: '有过这么一段。',
  maxTextLength: 600,
};

export class InstantMemory {
  constructor({ graph, options = {}, clock } = {}) {
    if (!graph) throw new Error('InstantMemory 需要 graph');
    this.graph = graph;
    this.options = { ...INSTANT_DEFAULTS, ...options };
    this.clock = clock || (() => Date.now());
  }

  store() { return this.graph.store; }

  keyed(scope, topicKey, eventKey, personKey = '') {
    return [scope, topicKey, eventKey, personKey].map((x) => normalizeText(x)).join('|');
  }

  write(scope, { text, topicKey, eventKey, personKey = '', writer = 'instant' } = {}) {
    if (!topicKey || !eventKey) throw new Error('即时记忆需要 topicKey 与 eventKey');
    const at = Number(this.clock());
    const s = this.graph.constructor.name === 'MemoryGraph' ? scope : scope;
    const node = {
      id: hashId('i'),
      scope: s,
      kind: 'instant',
      layer: 'instant',
      text: String(text ?? '').trim().slice(0, this.options.maxTextLength),
      topicKey: String(topicKey),
      eventKey: String(eventKey),
      personKey: String(personKey || ''),
      matterKey: this.keyed(s, topicKey, eventKey, personKey),
      instantStatus: 'awake',
      reviveCount: 0,
      createdAt: at,
      updatedAt: at,
      lastTouchedAt: at,
      anchors: [],
      mentionCount: 1,
      archived: false,
    };
    this.store().append(s, node);
    return node;
  }

  /** 把过期/休眠的即时记忆推进一个状态；返回变化 */
  tick(scope, { now = Number(this.clock()), apply = true } = {}) {
    const nodes = this.graph.load(scope).filter((n) => n.kind === 'instant' && !n.archived);
    const changes = [];
    for (const n of nodes) {
      const at = Number(n.lastTouchedAt || n.createdAt || now);
      const age = now - at;
      let status = n.instantStatus || 'awake';
      let next = null;
      if (status === 'awake' && age >= this.options.awakeMs) next = 'sleep';
      else if (status === 'sleep' && age >= this.options.awakeMs + this.options.sleepMs) next = 'expired';
      if (!next) continue;
      const updated = next === 'expired'
        ? { ...n, instantStatus: 'expired', text: this.options.tombstoneText, updatedAt: now, expiredAt: now }
        : { ...n, instantStatus: 'sleep', updatedAt: now };
      if (apply) this.store().append(scope, updated);
      changes.push({ id: n.id, from: status, to: next });
    }
    return changes;
  }

  /** 精确复活（topicKey/eventKey 必须完全一致，语义相近不算） */
  revive(scope, { topicKey, eventKey, personKey = '' } = {}) {
    const k = this.keyed(scope, topicKey, eventKey, personKey);
    const nodes = this.graph.load(scope).filter((n) => n.kind === 'instant' && !n.archived && n.matterKey === k);
    if (!nodes.length) return null;
    const last = nodes[nodes.length - 1];
    if (last.instantStatus === 'expired') return null;
    const at = Number(this.clock());
    const revives = Number(last.reviveCount || 0) + 1;
    if (revives >= this.options.revivesToPromote && last.instantStatus !== 'promoted') {
      const promoted = {
        ...last,
        id: hashId('n'),
        kind: 'fact',
        layer: 'short',
        instantStatus: 'promoted',
        text: String(last.text).slice(0, 200),
        anchors: [{ quote: String(last.text).slice(0, 200), source: 'instant-promote', at }],
        reviveCount: revives,
        createdAt: at,
        updatedAt: at,
        lastTouchedAt: at,
      };
      this.store().append(scope, promoted);
      this.store().append(scope, { ...last, instantStatus: 'promoted', updatedAt: at });
      return { promoted, reviveCount: revives };
    }
    this.store().append(scope, { ...last, instantStatus: 'awake', reviveCount: revives, lastTouchedAt: at, updatedAt: at });
    return { revived: last.id, reviveCount: revives };
  }
}
