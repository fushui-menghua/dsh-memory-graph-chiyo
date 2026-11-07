/**
 * extractor.js —— 从对话自动抽记忆
 *
 * 这一步是"记忆系统"和"聊天记录"的分界线：
 *   · 规则兜底：认出规矩/承诺（rules.js）
 *   · 事实启发式：喜欢/讨厌/害怕/想要/住在/在做…这类句子
 *   · 每条候选都带锚点（原话），过敏感过滤，带 idempotencyKey 防重复
 *
 * 想用大模型抽就把 extract 换成 modelExtract（同签名，返回候选数组）。
 */
import { hashId, normalizeText } from './core.js';
import { extractRules } from './rules.js';
import { assertNotSensitive, scanSensitive } from './sensitive.js';

const FACT_HINTS = [
  { re: /(喜欢|爱吃|爱看|爱听|最爱|偏好)/, category: 'preference' },
  { re: /(讨厌|不喜欢|受不了|烦)/, category: 'preference' },
  { re: /(害怕|怕|不敢)/, category: 'emotion' },
  { re: /(想要|想买|打算|计划|准备)/, category: 'plan' },
  { re: /(住在|家在|工作在|在.{0,6}(上班|工作|读书))/ , category: 'experience' },
  { re: /(生日|年纪|几岁)/, category: 'topic' },
  { re: /(妈妈|爸爸|哥哥|姐姐|弟弟|妹妹|朋友|同事|猫|狗)/, category: 'relationship' },
];

const splitSentences = (text) => String(text ?? '')
  .split(/[。！？!?\n；;]/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 4);

/** 启发式抽取（无模型） */
export function heuristicExtract(messages, { speaker = 'owner', max = 5 } = {}) {
  const out = [];
  for (const m of messages) {
    const text = typeof m === 'string' ? m : (m?.text ?? m?.content ?? '');
    const at = typeof m === 'object' ? (m.at ?? m.time) : undefined;
    // 规则优先
    for (const rule of extractRules(text, { speaker, at, max: 2 })) {
      out.push({ ...rule, idempotencyKey: `rule:${hashId(normalizeText(rule.text).slice(0, 24)).slice(2)}` });
      if (out.length >= max) return out;
    }
    for (const s of splitSentences(text)) {
      const hit = FACT_HINTS.find((h) => h.re.test(s));
      if (!hit) continue;
      out.push({
        kind: 'fact',
        text: s.slice(0, 200),
        category: hit.category,
        cluster: 'fact-auto',
        anchors: [{ quote: s.slice(0, 200), source: speaker === 'self' ? '她说' : '主人说', at }],
        idempotencyKey: `fact:${hashId(normalizeText(s).slice(0, 24)).slice(2)}`,
      });
      if (out.length >= max) break;
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 抽取并落盘：过滤敏感、校验锚点、按幂等键去重。
 * @returns {{written:Array, merged:Array, skipped:Array}}
 */
export function extractAndWrite(memory, scope, messages, { speaker = 'owner', max = 5, minAnchors = true } = {}) {
  const candidates = heuristicExtract(messages, { speaker, max });
  const written = [];
  const merged = [];
  const skipped = [];
  for (const c of candidates) {
    try {
      if (scanSensitive(c.text).length) { skipped.push({ text: c.text.slice(0, 40), why: 'sensitive' }); continue; }
      if (minAnchors && !(c.anchors || []).length) { skipped.push({ text: c.text.slice(0, 40), why: 'no-anchor' }); continue; }
      const r = memory.write(scope, { nodes: [c], messages: minAnchors ? messages : null });
      written.push(...r.written);
      merged.push(...r.merged);
    } catch (e) {
      skipped.push({ text: c.text.slice(0, 40), why: e.message.slice(0, 60) });
    }
  }
  return { written, merged, skipped };
}

/** 给大模型用的提示词：让它按同样格式返回候选 */
export function buildExtractionPrompt(messages) {
  const body = messages.map((m) => `- ${typeof m === 'string' ? m : (m.text ?? m.content ?? '')}`).join('\n');
  return `从下面这些对话里抽取值得长期记住的内容，只返回 JSON 数组，每项形如：
{"kind":"fact|impression|plan","text":"一句陈述","category":"preference|experience|relationship|plan|emotion|topic","anchors":[{"quote":"原文里的原话片段"}]}

规则：锚点必须是原文里真实存在的片段；只抽长期有用的事，寒暄和一次性安排不要；最多 5 条。
对话：
${body}`;
}
