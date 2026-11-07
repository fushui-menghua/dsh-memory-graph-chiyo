/**
 * person.js —— 人物层
 *
 * 记忆里最容易被搞乱的不是事实，是"谁是谁"：
 * 同一个人的不同称呼、同名的两个人、聊天里出现但没登记的人。
 *
 * 这一层只做三件事：
 *   1. 登记/更新人物（名字、别名、一句话印象）
 *   2. 提议合并两个人物（同一个人两个名字），需要批准
 *   3. 列出已确认/待确认
 */
import { hashId } from './core.js';

export const PERSON_SCOPE = 'person:global';

export class PersonLayer {
  constructor({ store, clock } = {}) {
    if (!store) throw new Error('PersonLayer 需要 store');
    this.store = store;
    this.clock = clock || (() => Date.now());
  }

  now() { return Number(this.clock()); }

  load() { return this.store.load(PERSON_SCOPE).filter((p) => !p.archived); }

  /** 登记或更新一个人 */
  upsert({ name, aliases = [], note = '', confirmed = false } = {}) {
    const n = String(name ?? '').trim();
    if (!n) throw new Error('缺少 name');
    const existing = this.load().find((p) => p.name === n || (p.aliases || []).includes(n));
    const at = this.now();
    if (existing) {
      const merged = {
        ...existing,
        aliases: [...new Set([...(existing.aliases || []), ...aliases, n].filter((x) => x && x !== existing.name))],
        note: note || existing.note,
        updatedAt: at,
        confirmed: existing.confirmed || confirmed,
      };
      this.store.append(PERSON_SCOPE, merged);
      return merged;
    }
    const person = {
      id: hashId('p'),
      name: n,
      aliases: [...new Set(aliases.filter((x) => x && x !== n))],
      note: String(note).slice(0, 200),
      confirmed: Boolean(confirmed),
      createdAt: at,
      updatedAt: at,
    };
    this.store.append(PERSON_SCOPE, person);
    return person;
  }

  /** 提议合并（同一个人两个名字） */
  proposeMerge(aName, bName, { reason = '' } = {}) {
    const list = this.load();
    const a = list.find((p) => p.name === aName || (p.aliases || []).includes(aName));
    const b = list.find((p) => p.name === bName || (p.aliases || []).includes(bName));
    if (!a || !b) throw new Error('待合并的人物不存在');
    if (a.id === b.id) throw new Error('是同一个人，不用合并');
    const at = this.now();
    const proposal = {
      id: hashId('m'),
      kind: 'merge-proposal',
      fromId: b.id,
      intoId: a.id,
      reason: String(reason).slice(0, 200),
      status: 'proposed',
      createdAt: at,
      updatedAt: at,
    };
    this.store.append(PERSON_SCOPE, proposal);
    return proposal;
  }

  /** 批准合并：把 b 的名字并进 a 的别名 */
  approveMerge(proposalId, { by = 'unknown' } = {}) {
    const all = this.store.load(PERSON_SCOPE);
    const p = all.find((x) => x.id === proposalId && x.kind === 'merge-proposal');
    if (!p) throw new Error('合并提议不存在');
    if (p.status !== 'proposed') throw new Error(`该提议已是 ${p.status}`);
    const target = all.find((x) => x.id === p.intoId);
    const source = all.find((x) => x.id === p.fromId);
    if (!target || !source) throw new Error('人物记录缺失');
    const at = this.now();
    const merged = {
      ...target,
      aliases: [...new Set([...(target.aliases || []), source.name, ...(source.aliases || [])].filter((x) => x && x !== target.name))],
      note: target.note || source.note,
      confirmed: true,
      updatedAt: at,
    };
    this.store.append(PERSON_SCOPE, merged);
    this.store.append(PERSON_SCOPE, { ...source, archived: true, mergedInto: target.id, updatedAt: at });
    this.store.append(PERSON_SCOPE, { ...p, status: 'approved', approvedBy: String(by).slice(0, 60), updatedAt: at });
    return merged;
  }

  /** 别名解析：给一个称呼，找到登记的人 */
  resolve(name) {
    const n = String(name ?? '').trim();
    return this.load().find((p) => p.name === n || (p.aliases || []).includes(n)) || null;
  }

  list({ includeProposals = false } = {}) {
    const rows = this.load();
    const persons = rows.filter((p) => p.kind !== 'merge-proposal');
    if (!includeProposals) return persons;
    const proposals = rows.filter((p) => p.kind === 'merge-proposal' && p.status === 'proposed');
    return { persons, proposals };
  }
}
