/**
 * persona.js —— 人格旋钮（角色扮演层，不是记忆）
 *
 * ⚠️ 说明（很重要）：
 *   这一层跟记忆系统是**分开的两件事**。记忆负责"记住发生过什么"，
 *   人格负责"用什么性格说话"。把它们放同一个包里，只是因为一个陪伴型
 *   agent 两样都需要；不需要人格的话完全可以不调用。
 *
 * 六个旋钮（0–1）：
 *   tsundere 傲娇 / playfulness 爱玩 / initiative 主动 /
 *   softness 心软 / snark 吐槽 / moodSwing 情绪起伏
 *
 * 刹车（防止人格一夜之间漂走）：
 *   · 单次调整幅度 ≤ maxStep（默认 0.05）
 *   · 每天最多调 maxPerDay 次（默认 1）
 *   · 距基线累计偏移 ≤ maxDrift（默认 0.15）
 *   · 每次调整留历史，可回滚
 */
import { hashId } from './core.js';

export const PERSONA_SCOPE = 'persona:global';

export const DEFAULT_KNOBS = {
  tsundere: 0.5,
  playfulness: 0.5,
  initiative: 0.5,
  softness: 0.5,
  snark: 0.5,
  moodSwing: 0.5,
};

export const KNOB_LABELS = {
  tsundere: '傲娇',
  playfulness: '爱玩',
  initiative: '主动',
  softness: '心软',
  snark: '吐槽',
  moodSwing: '情绪起伏',
};

export const PERSONA_LIMITS = { maxStep: 0.05, maxPerDay: 1, maxDrift: 0.15 };

const DAY = 24 * 60 * 60 * 1000;

export class Persona {
  constructor({ store, clock, limits = {} } = {}) {
    if (!store) throw new Error('Persona 需要 store');
    this.store = store;
    this.clock = clock || (() => Date.now());
    this.limits = { ...PERSONA_LIMITS, ...limits };
  }

  now() { return Number(this.clock()); }

  state() {
    const rows = this.store.load(PERSONA_SCOPE).filter((r) => r.kind === 'persona-state');
    const last = rows[rows.length - 1];
    return last || { kind: 'persona-state', id: hashId('pa'), base: { ...DEFAULT_KNOBS }, current: { ...DEFAULT_KNOBS }, history: [] };
  }

  get() {
    return { ...this.state().current };
  }

  /** 调一个旋钮：delta 有正负，会被 maxStep 夹住；返回新状态 */
  tune(key, delta, { by = 'owner', reason = '' } = {}) {
    if (!(key in DEFAULT_KNOBS)) throw new Error(`未知旋钮：${key}`);
    const st = this.state();
    const at = this.now();
    const today = new Date(at).toLocaleDateString('sv-SE');
    const todayCount = (st.history || []).filter((h) => h.date === today).length;
    if (todayCount >= this.limits.maxPerDay) {
      throw new Error(`今天已经调过 ${todayCount} 次了（上限 ${this.limits.maxPerDay}），明天再调`);
    }
    const step = Math.max(-this.limits.maxStep, Math.min(this.limits.maxStep, Number(delta) || 0));
    const before = Number(st.current[key] ?? DEFAULT_KNOBS[key]);
    let after = Math.max(0, Math.min(1, before + step));
    const base = Number(st.base[key] ?? DEFAULT_KNOBS[key]);
    const drift = after - base;
    if (Math.abs(drift) > this.limits.maxDrift) {
      after = base + Math.sign(drift) * this.limits.maxDrift;
      after = Math.max(0, Math.min(1, after));
    }
    const next = {
      ...st,
      id: st.id || hashId('pa'),
      kind: 'persona-state',
      current: { ...st.current, [key]: Number(after.toFixed(3)) },
      base: { ...st.base },
      history: [...(st.history || []), { date: today, key, from: before, to: Number(after.toFixed(3)), by, reason: String(reason).slice(0, 200), at }],
      updatedAt: at,
    };
    this.store.append(PERSONA_SCOPE, next);
    return next.current;
  }

  /** 回滚到上一版 */
  revert() {
    const rows = this.store.load(PERSONA_SCOPE).filter((r) => r.kind === 'persona-state');
    if (rows.length < 2) throw new Error('没有可回滚的历史');
    const prev = rows[rows.length - 2];
    const at = this.now();
    const next = { ...prev, id: hashId('pa'), updatedAt: at, revertedAt: at };
    this.store.append(PERSONA_SCOPE, next);
    return next.current;
  }

  /** 给提示词用的一段人话 */
  summary() {
    const c = this.get();
    const lv = (v) => (v >= 0.75 ? '很高' : v >= 0.55 ? '偏高' : v >= 0.45 ? '中等' : v >= 0.25 ? '偏低' : '很低');
    return Object.entries(c).map(([k, v]) => `${KNOB_LABELS[k] || k} ${lv(v)}`).join('；');
  }
}
