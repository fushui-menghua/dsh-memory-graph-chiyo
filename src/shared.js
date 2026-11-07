/**
 * shared.js —— 共享记忆：propose → approve → 跨会话可见 → 可撤销
 *
 * 为什么需要审批：
 *   一个 scope（比如某个群或某次私聊）看到的东西，直接放进全局共享，
 *   等于替别人公开了私下的内容。所以默认只能"提名"，批准后才可见。
 *
 * 存储：独立的 shared 作用域，不污染任何用户 scope。
 */
import { hashId, normalizeText, similarity } from './core.js';

export const SHARED_SCOPE = 'shared:global';
export const AUDIT_SCOPE = 'shared:audit';

export class SharedMemory {
  constructor({ store, clock, dailyQuota = 3 } = {}) {
    if (!store) throw new Error('SharedMemory 需要 store');
    this.store = store;
    this.clock = clock || (() => Date.now());
    this.dailyQuota = dailyQuota;
  }

  now() { return Number(this.clock()); }

  load() { return this.store.load(SHARED_SCOPE).filter((e) => !e.archived); }

  /** 提名一条共享记忆（默认 pending） */
  propose({ text, sourceScope, judgment = '', by = 'unknown', event = '', sensitive = false, lowConfidence = false, dependsOn = [] } = {}) {
    const quota = Number(this.dailyQuota) || 3;
    const today = new Date(this.now()).toLocaleDateString('sv-SE');
    const todayCount = this.load().filter((e) => e.proposedAt && new Date(e.proposedAt).toLocaleDateString('sv-SE') === today).length;
    if (todayCount >= quota) throw new Error(`今天已经提名 ${todayCount} 条共享记忆（每日上限 ${quota}）`);
    const body = String(text ?? '').trim().slice(0, 1000);
    if (body.length < 4) throw new Error('共享记忆太短');
    if (!sourceScope) throw new Error('缺少 sourceScope');
    const at = this.now();
    const entry = {
      id: hashId('s'),
      text: body,
      judgment: String(judgment).slice(0, 500),
      event: String(event).slice(0, 300),
      sourceScope: String(sourceScope),
      status: 'proposed',
      sensitive: sensitive === true,
      lowConfidence: lowConfidence === true,
      proposedBy: String(by).slice(0, 60),
      proposedAt: at,
      updatedAt: at,
      dependsOn: (Array.isArray(dependsOn) ? dependsOn : []).filter((x) => typeof x === 'string').slice(0, 10),
    };
    this.store.append(SHARED_SCOPE, entry);
    this._audit('propose', entry.id, { by, sourceScope });
    return entry;
  }

  /** 批准：进入可召回集合 */
  approve(id, { by = 'unknown' } = {}) {
    const r = this._transition(id, 'approved', { approvedBy: String(by).slice(0, 60), approvedAt: this.now() });
    this._audit('approve', id, { by });
    return r;
  }

  /** 撤销：立刻从召回里消失，但保留记录 */
  revoke(id, { by = 'unknown', reason = '', cascade = true } = {}) {
    const r = this._transition(id, 'revoked', { revokedBy: String(by).slice(0, 60), revokedAt: this.now(), revokeReason: String(reason).slice(0, 300) });
    this._audit('revoke', id, { by, reason, cascade });
    if (cascade) {
      for (const child of this.load().filter((e) => e.status === 'approved' && (e.dependsOn || []).includes(id))) {
        this.revoke(child.id, { by, reason: '上游被撤销', cascade: true });
      }
    }
    return r;
  }
  _audit(action, id, extra = {}) {
    try {
      this.store.append(AUDIT_SCOPE, { id: 'a_' + Math.random().toString(16).slice(2, 10), action, targetId: id, at: this.now(), ...extra });
    } catch {}
  }
  audit({ limit = 50 } = {}) {
    return this.store.load(AUDIT_SCOPE).slice(-limit);
  }

  _transition(id, status, patch) {
    const entry = this.load().find((e) => e.id === id);
    if (!entry) throw new Error('共享条目不存在');
    const at = this.now();
    const updated = { ...entry, ...patch, status, updatedAt: at };
    this.store.append(SHARED_SCOPE, updated);
    return updated;
  }

  list({ status = '' } = {}) {
    const rows = this.load();
    return status ? rows.filter((e) => e.status === status) : rows;
  }

  /** 只召回 approved；相似度 + 关键词 */
  recall({ query = '', limit = 10 } = {}) {
    const now = this.now();
    return this.load()
      .filter((e) => e.status === 'approved')
      .map((e) => {
        const text = `${e.text} ${e.judgment || ''}`.trim();
        const sim = query ? similarity(query, text) : 0;
        const keywordHit = query && normalizeText(text).includes(normalizeText(query)) ? 0.4 : 0;
        return { entry: e, score: sim * 2 + keywordHit };
      })
      .filter((x) => (query ? x.score > 0.05 : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ ...x.entry, score: Number(x.score.toFixed(3)) }));
  }
}
