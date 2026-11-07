/**
 * anchor.js —— 锚点校验：引文必须真的在原文里
 *
 * 为什么需要：
 *   如果只要求 "anchors 非空"，模型可以编一句引文糊弄过去，
 *   记忆就变成了"看起来有出处"。这里要求锚点的 quote 必须能在
 *   传入的原始消息里找到（允许前缀差异，比如 "主人：" 这种说话人前缀）。
 */
import { normalizeText } from './core.js';

/** 去掉常见的说话人前缀与引号，保留正文 */
export function stripPrefix(quote) {
  return String(quote ?? '')
    .replace(/^\s*(?:主人|用户|我|她|他|你|群友|assistant|user)\s*[:：]\s*/i, '')
    .replace(/^["'「『]|["'」』]$/g, '')
    .trim();
}

/** 一条引文是否出现在给定消息集合里 */
export function quoteExists(quote, messages = []) {
  const q = normalizeText(stripPrefix(quote));
  if (!q) return false;
  for (const m of messages) {
    const text = normalizeText(typeof m === 'string' ? m : (m?.text ?? m?.content ?? ''));
    if (!text) continue;
    if (text.includes(q)) return true;
  }
  return false;
}

/** 批量校验：返回缺失的引文列表（空数组 = 全部通过） */
export function findMissingAnchors(anchors = [], messages = []) {
  const missing = [];
  for (const a of anchors) {
    const quote = a?.quote ?? a;
    if (!quoteExists(quote, messages)) missing.push(String(quote).slice(0, 120));
  }
  return missing;
}

/**
 * 从一条消息里抽锚点：按句子切，挑和 node 文本最像的那句。
 * 用于"模型只给了结论，让库自己找原话"的场景。
 */
export function extractAnchors(text, messages = [], { max = 2, minLen = 6 } = {}) {
  const sentences = String(text ?? '')
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen);
  const out = [];
  for (const s of sentences) {
    for (const m of messages) {
      const body = typeof m === 'string' ? m : (m?.text ?? m?.content ?? '');
      if (!body) continue;
      if (normalizeText(body).includes(normalizeText(s))) {
        out.push({ quote: s.slice(0, 200), source: typeof m === 'object' ? m.source : undefined, at: typeof m === 'object' ? m.at : undefined });
        break;
      }
    }
    if (out.length >= max) break;
  }
  return out;
}
