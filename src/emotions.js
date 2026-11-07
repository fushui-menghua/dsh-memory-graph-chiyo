/**
 * emotions.js —— 情绪记忆层
 *
 * 跟人格旋钮的区别：
 *   人格旋钮（persona.js）= "她平时什么性格"
 *   情绪记忆（这里）    = "她这段时间什么心情，因为什么"
 *
 * 存两样东西：
 *   1. 心情时间线：什么时候什么情绪、因为什么（可回溯）
 *   2. 情绪标签：某条记忆当时是什么感觉（"想起这件事她还在生气"）
 */
import { hashId } from './core.js';

export const MOOD_SCOPE = 'mood:global';
export const MOOD_LABELS = ['平静', '开心', '低落', '烦躁', '委屈', '兴奋', '累', '暖'];

export class MoodLayer {
  constructor({ store, clock } = {}) {
    if (!store) throw new Error('MoodLayer 需要 store');
    this.store = store;
    this.clock = clock || (() => Date.now());
  }

  now() { return Number(this.clock()); }

  /** 记一次心情（scope 用 'agent:xxx' 这类，跟记忆分区一致） */
  set(scope, { label, intensity = 0.5, reason = '', tags = [] } = {}) {
    const s = String(scope);
    const mood = String(label || '').trim();
    if (!mood) throw new Error('缺少 label');
    const at = this.now();
    const record = {
      id: hashId('m'),
      kind: 'mood',
      scope: s,
      label: mood,
      intensity: Math.max(0, Math.min(1, Number(intensity) || 0.5)),
      reason: String(reason).slice(0, 200),
      tags: (Array.isArray(tags) ? tags : []).filter(Boolean).slice(0, 6).map(String),
      at,
      updatedAt: at,
    };
    this.store.append(MOOD_SCOPE, record);
    return record;
  }

  /** 当前心情 = 最近一条（超过 maxAgeHours 视为"没记录"） */
  current(scope, { maxAgeHours = 48 } = {}) {
    const rows = this.load(scope);
    const last = rows[rows.length - 1];
    if (!last) return null;
    if (this.now() - Number(last.at) > maxAgeHours * 3600 * 1000) return null;
    return last;
  }

  /** 心情时间线（新的在前） */
  history(scope, { limit = 20 } = {}) {
    return this.load(scope).slice(-limit).reverse();
  }

  /** 给一条记忆情绪打标（写成一个独立的 emotion 记忆节点） */
  tagMemory(scope, { text, label, anchor }) {
    const s = String(scope);
    const at = this.now();
    const node = {
      id: hashId('e'),
      kind: 'impression',
      scope: s,
      text: String(text || label).slice(0, 200),
      category: 'emotion',
      cluster: `mood-${label}`,
      anchors: anchor ? [{ quote: String(anchor).slice(0, 200) }] : [],
      layer: 'short',
      mentionCount: 1,
      recallCount: 0,
      importance: 0.5,
      createdAt: at,
      updatedAt: at,
      lastTouchedAt: at,
      archived: false,
    };
    this.store.append(s, node);
    return node;
  }

  load(scope) {
    return this.store.load(MOOD_SCOPE).filter((r) => r.kind === 'mood' && r.scope === String(scope));
  }

  /** 最近 N 天的情绪分布（给提示词用） */
  summary(scope, { days = 7 } = {}) {
    const cut = this.now() - days * 86400000;
    const rows = this.load(scope).filter((r) => Number(r.at) >= cut);
    if (!rows.length) return '';
    const count = {};
    for (const r of rows) count[r.label] = (count[r.label] || 0) + 1;
    const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const cur = this.current(scope);
    const curText = cur ? `现在：${cur.label}${cur.reason ? `（因为${cur.reason}）` : ''}` : '现在：平静';
    return `【情绪】${curText}；近${days}天：${top.map(([k, v]) => `${k}×${v}`).join('、')}`;
  }
}
