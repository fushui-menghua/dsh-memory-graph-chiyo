/**
 * bridge.js —— 桥接场景适配层（给"QQ/微信桥接 + DSH 人格机器人"用）
 *
 * 为什么需要它：
 *   插件装上只给了 5 个工具，桥接不会自动"每轮查记忆、每轮写记忆"。
 *   这一层把两个动作收成两个函数，桥接里各加一行即可：
 *
 *     const bm = createBridgeMemory({ dir, scope: 'agent:chiyo' });
 *
 *     // 每轮开始前（把返回值拼进提示词）
 *     const block = bm.beforeTurn({ query: 用户这句话 });
 *
 *     // 每轮结束后（自动抽取值得记的）
 *     bm.afterTurn({ messages: [{ text: 用户这句话 }, { text: 她的回复 }], speaker: 'owner' });
 *
 *     // 每天凌晨（也可以交给 CLI：memory-graph nightly --apply）
 *     bm.nightly({ apply: true });
 */
import { createMemory } from './index.js';

export const BRIDGE_DEFAULTS = {
  scope: 'agent:memory',
  tokenBudget: 1200,
  extract: true,
  maxPerTurn: 5,
  includeShared: true,
};

export function createBridgeMemory(config = {}) {
  const opts = { ...BRIDGE_DEFAULTS, ...config };
  const mem = createMemory({ dir: opts.dir, clock: opts.clock });
  const scope = String(opts.scope);
  let buffer = [];

  return {
    mem,
    scope,

    /** 每轮开始：返回要拼进提示词的记忆块（没有命中就返回空串） */
    beforeTurn({ query = '', scopes = null, tokenBudget = opts.tokenBudget } = {}) {
      const list = Array.isArray(scopes) && scopes.length ? scopes : [scope];
      try {
        const r = mem.assembleContext({ scopes: list, query, tokenBudget, includeShared: opts.includeShared });
        return r.text || '';
      } catch {
        return ''; // 记忆挂了不能拖垮对话
      }
    },

    /** 每轮结束：从这一轮消息里抽记忆并落盘（规则兜底，不调模型） */
    afterTurn({ messages = [], speaker = 'owner', max = opts.maxPerTurn } = {}) {
      if (!opts.extract) return { written: 0, merged: 0, skipped: 0, disabled: true };
      try {
        const r = mem.extractAndWrite(scope, messages, { speaker, max });
        return { written: r.written.length, merged: r.merged.length, skipped: r.skipped.length, items: r.written.map((n) => n.text) };
      } catch (e) {
        return { written: 0, merged: 0, skipped: 0, error: e.message };
      }
    },

    /** 夜间整理（默认 dry-run，跟 CLI 行为一致） */
    nightly({ apply = false, now } = {}) {
      return mem.nightly([scope], { apply, ...(now ? { now } : {}) });
    },

    health() { return mem.healthReport({ scope }); },

    recall(query, o = {}) { return mem.recall(scope, { query, ...o }); },

    /** 手动写入（桥接里想精确控制时用） */
    write(nodes) { return mem.write(scope, { nodes }); },

    /** 情绪：记一次心情 / 查当前心情 / 近七天摘要 */
    mood: {
      set: (input) => mem.mood.set(scope, input),
      current: () => mem.mood.current(scope),
      history: (o) => mem.mood.history(scope, o),
      summary: (o) => mem.mood.summary(scope, o),
      tagMemory: (input) => mem.mood.tagMemory(scope, input),
    },
    /** 做梦：挑素材 → 生成提示词 → 记梦 */
    dream: {
      seed: (o) => mem.dream.seed(mem.graph, scope, o),
      buildPrompt: (seed, o) => mem.dream.buildPrompt(seed, o),
      template: (seed) => mem.dream.templateDream(seed),
      record: (input) => mem.dream.record({ scope, ...input }),
      list: (o) => mem.dream.list({ scope, ...(o || {}) }),
    },
    /** 待办：加 / 完成 / 下一件 / 摘要 */
    tasks: {
      add: (input) => mem.tasks.add(scope, input),
      done: (id, o) => mem.tasks.done(scope, id, o),
      pickNext: () => mem.tasks.pickNext(scope),
      stats: () => mem.tasks.stats(scope),
      summary: () => mem.tasks.summary(scope),
    },
    /** 逐条喂消息：assistant 到达时自动抽取（桥接里每收到一条调一次） */
    observe({ role = 'user', text = '' } = {}) {
      if (role === 'assistant' || role === 'self') {
        const out = this.afterTurn({ messages: buffer, speaker: 'owner' });
        buffer = [];
        return out;
      }
      buffer.push({ text: String(text) });
      return { buffered: buffer.length };
    },

    /** 做梦的时间窗判断：凌晨窗口内且今天还没做过 → 返回素材和提示词 */
    dreamTick({ fromHour = 2, toHour = 7, now = Date.now(), hour, timeZone } = {}) {
      // 服务器时区可能不是本地：允许显式给 hour，或给 IANA 时区
      let h;
      if (Number.isFinite(Number(hour))) h = Number(hour);
      else if (timeZone) {
        h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(new Date(now)));
      } else h = new Date(now).getHours();
      if (h < fromHour || h >= toHour) return null;
      const today = new Date(now).toLocaleDateString('sv-SE');
      const done = mem.dream.list({ scope, limit: 20 }).some((d) => d.date === today);
      if (done) return null;
      const seed = mem.dream.seed(mem.graph, scope);
      if (!seed.length) return null;
      return { seed, prompt: mem.dream.buildPrompt(seed), fallback: mem.dream.templateDream(seed) };
    },

    /** 昨晚的梦（给次日唤醒注入用；不自动标记已读） */
    lastNightDream() {
      return mem.dream.latest({ scope });
    },

    /** 待办节拍：挑下一件并标 doing，返回建议间隔（分钟） */
    plan({ suggestedMinutes = 15 } = {}) {
      const next = mem.tasks.pickNext(scope);
      if (!next) return null;
      try { mem.tasks._transition(scope, next.id, 'doing', { startedAt: Date.now() }); } catch {}
      return { task: next, suggestedMinutes };
    },

    shared: mem.shared,
    store: mem.store,
    graph: mem.graph,
  };
}
