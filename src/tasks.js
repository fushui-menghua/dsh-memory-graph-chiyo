/**
 * tasks.js —— 自己的待办
 *
 * 为什么放在记忆包里：待办是"她接下来要做什么"，跟"她记得什么"是同一套上下文。
 * 这里只存和挑，不负责定时唤醒（那是桥接/调度层的事）。
 */
import { hashId } from './core.js';

export const TASK_SCOPE = 'task:global';
export const TASK_STATUSES = ['todo', 'doing', 'done', 'dropped'];

export class TaskList {
  constructor({ store, clock } = {}) {
    if (!store) throw new Error('TaskList 需要 store');
    this.store = store;
    this.clock = clock || (() => Date.now());
  }

  now() { return Number(this.clock()); }

  load(scope) {
    return this.store.load(TASK_SCOPE).filter((t) => t.kind === 'task' && t.scope === String(scope));
  }

  /** 当前有效任务（同一 id 后写覆盖前写） */
  active(scope) {
    const byId = new Map();
    for (const t of this.load(scope)) byId.set(t.id, t);
    return [...byId.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }

  add(scope, { text, source = 'self', tags = [] } = {}) {
    const body = String(text || '').trim();
    if (body.length < 2) throw new Error('任务太短');
    const at = this.now();
    const task = {
      id: hashId('t'),
      kind: 'task',
      scope: String(scope),
      text: body.slice(0, 200),
      source: String(source).slice(0, 20),
      tags: (Array.isArray(tags) ? tags : []).slice(0, 6).map(String),
      status: 'todo',
      createdAt: at,
      updatedAt: at,
    };
    this.store.append(TASK_SCOPE, task);
    return task;
  }

  done(scope, id, { note = '' } = {}) {
    return this._transition(scope, id, 'done', { note });
  }

  drop(scope, id, { note = '' } = {}) {
    return this._transition(scope, id, 'dropped', { note });
  }

  _transition(scope, id, status, patch = {}) {
    const cur = this.active(scope).find((t) => t.id === id);
    if (!cur) throw new Error('任务不存在');
    const at = this.now();
    const next = { ...cur, ...patch, status, updatedAt: at };
    this.store.append(TASK_SCOPE, next);
    return next;
  }

  /** 挑下一件：先 doing，再最早创建的 todo */
  pickNext(scope) {
    const list = this.active(scope);
    return list.find((t) => t.status === 'doing') || list.find((t) => t.status === 'todo') || null;
  }

  stats(scope) {
    const list = this.active(scope);
    const by = {};
    for (const t of list) by[t.status] = (by[t.status] || 0) + 1;
    return { total: list.length, by, todo: by.todo || 0, doing: by.doing || 0, done: by.done || 0 };
  }

  /** 给提示词用的一段 */
  summary(scope) {
    const s = this.stats(scope);
    if (!s.total) return '';
    const next = this.pickNext(scope);
    const lines = [`【待办】${s.todo} 件没做、${s.done} 件做完`];
    if (next) lines.push(`- 下一件：${next.text}`);
    return lines.join('\n');
  }
}
