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
      familiarity: 0,
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

  /** 熟悉度：见面/深聊就加一点，长期不联系会衰减 */
  bumpFamiliarity(name, delta = 0.05, { reason = '' } = {}) {
    const person = this.resolve(name);
    if (!person) throw new Error('人物不存在');
    const at = this.now();
    const next = {
      ...person,
      familiarity: Math.max(0, Math.min(1, Number(person.familiarity || 0) + Number(delta || 0))),
      updatedAt: at,
      lastMetAt: at,
      familiarityReason: String(reason).slice(0, 100),
    };
    this.store.append(PERSON_SCOPE, next);
    return next;
  }

  /** 熟悉度衰减：默认 180 天半衰期 */
  decayFamiliarity({ halfLifeDays = 180, min = 0.01 } = {}) {
    const at = this.now();
    const changed = [];
    for (const p of this.load()) {
      if (p.kind === 'merge-proposal') continue;
      const fam = Number(p.familiarity || 0);
      if (fam <= 0) continue;
      const idleDays = Math.max(0, at - Number(p.lastMetAt || p.updatedAt || at)) / 86400000;
      const next = fam * Math.pow(0.5, idleDays / halfLifeDays);
      if (next < min) {
        this.store.append(PERSON_SCOPE, { ...p, familiarity: 0, updatedAt: at });
        changed.push({ name: p.name, from: fam, to: 0 });
      } else if (Math.abs(next - fam) > 1e-6) {
        this.store.append(PERSON_SCOPE, { ...p, familiarity: Number(next.toFixed(3)), updatedAt: at });
        changed.push({ name: p.name, from: fam, to: Number(next.toFixed(3)) });
      }
    }
    return changed;
  }

  /**
   * 合并并把指向旧人物的关系重指到新人物（需要传入 memory.graph 才能改节点）。
   * 不传 graph 时退化成普通 approveMerge。
   */
  mergeAndRelink(graph, proposalId, { by = 'unknown', scope = null } = {}) {
    const all = this.store.load(PERSON_SCOPE);
    const p = all.find((x) => x.id === proposalId && x.kind === 'merge-proposal');
    if (!p) throw new Error('合并提议不存在');
    const merged = this.approveMerge(proposalId, { by });
    let relinked = 0;
    if (graph && scope) {
      const nodes = graph.load(scope);
      for (const node of nodes) {
        if (node.archived) continue;
        const rels = node.relations || [];
        if (!rels.some((r) => r.targetId === p.fromId)) continue;
        const next = rels.map((r) => (r.targetId === p.fromId ? { ...r, targetId: p.intoId } : r));
        graph.store.append(scope, { ...node, relations: next, updatedAt: this.now() });
        relinked += 1;
      }
    }
    return { merged, relinked };
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
