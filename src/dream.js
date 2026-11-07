/**
 * dream.js —— 做梦（记忆重组）
 *
 * 不调模型也能用：
 *   · seed()        从记忆里挑"今天/最近值得入梦"的碎片（锚点原文优先）
 *   · buildPrompt() 生成给模型写梦的提示词（想用模型就传进去）
 *   · record()      把梦存下来（带情绪 + 引用了哪些记忆）
 *   · list()        翻做过的梦
 *
 * 设计原则跟记忆一致：梦要能回到素材，不是凭空编的文艺段落。
 */
import { hashId } from './core.js';

export const DREAM_SCOPE = 'dream:global';

export class DreamLayer {
  constructor({ store, clock } = {}) {
    if (!store) throw new Error('DreamLayer 需要 store');
    this.store = store;
    this.clock = clock || (() => Date.now());
  }

  now() { return Number(this.clock()); }

  /** 挑入梦素材：最近 N 天里有锚点的节点，按重要度排序 */
  seed(memory, scope, { days = 3, limit = 8 } = {}) {
    const cut = this.now() - days * 86400000;
    return memory.load(scope)
      .filter((n) => !n.archived && !n.superseded && (n.anchors || []).length)
      .filter((n) => Number(n.createdAt || n.updatedAt || 0) >= cut || Number(n.importance || 0) >= 1)
      .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0))
      .slice(0, limit)
      .map((n) => ({ id: n.id, text: n.text, quote: n.anchors[0]?.quote || '', category: n.category, layer: n.layer }));
  }

  /** 给大模型写梦用的提示词（不传模型时你可以自己写，或直接用模板拼） */
  buildPrompt(seed, { style = '第一人称，150–400 字，像梦不像作文' } = {}) {
    const lines = seed.map((s, i) => `${i + 1}. ${s.text}${s.quote ? `（原话：${s.quote}）` : ''}`).join('\n');
    return `把下面这些真实发生过的事揉成一个梦。可以荒诞、可以错位、可以碎，但里面要有这些真东西。

${lines}

要求：${style}。不要解释、不要写成总结，就像刚醒过来随口讲。`;
  }

  /** 没有模型时的模板梦（确定性拼接，能跑通流程） */
  templateDream(seed) {
    if (!seed.length) return null;
    const parts = seed.slice(0, 4).map((s) => s.text);
    return `我梦见${parts[0]}。后来场景换了，${parts[1] || '有个人在叫我'}。` +
      `${parts[2] ? `还闪过一句「${seed[2].quote || parts[2]}」。` : ''}` +
      `醒来只记得这些，别的都散了。`;
  }

  /** 记一场梦 */
  record({ scope, text, mood = '', seedIds = [], template = false } = {}) {
    const body = String(text || '').trim();
    if (body.length < 10) throw new Error('梦太短，至少写两句');
    const at = this.now();
    const dream = {
      id: hashId('d'),
      kind: 'dream',
      scope: String(scope || 'agent:memory'),
      text: body.slice(0, 2000),
      mood: String(mood).slice(0, 20),
      seedIds: (Array.isArray(seedIds) ? seedIds : []).slice(0, 12).map(String),
      template: template === true,
      date: new Date(at).toLocaleDateString('sv-SE'),
      at,
      updatedAt: at,
    };
    this.store.append(DREAM_SCOPE, dream);
    return dream;
  }

  list({ scope = '', limit = 20 } = {}) {
    const rows = this.store.load(DREAM_SCOPE).filter((r) => r.kind === 'dream' && (!scope || r.scope === String(scope)));
    return rows.slice(-limit).reverse();
  }

  /** 昨晚的梦（今天或昨天做的最近一场） */
  latest({ scope = '' } = {}) {
    return this.list({ scope, limit: 5 })[0] || null;
  }
}
