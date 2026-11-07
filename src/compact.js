/**
 * compact.js —— 上下文压缩（带锚点）
 *
 * 跟普通压缩的区别：
 *   普通压缩：把旧轮次丢掉，生成一段摘要，原话永久消失。
 *   这里：摘要旁边挂着 anchors（原始事件 id 列表），shadowed 事件默认还给你，
 *        随时能 expand() 回到原文——"摘要可回溯"。
 *
 * 三个层次（跟她在用的那套一致）：
 *   1. prune：工具输出太长 → 掐头去尾（最省，不丢信息骨架）
 *   2. compact：超过阈值 → 旧轮次折叠成摘要 + 保留最近 N 轮
 *   3. stats：每次压缩放掉多少 token、留了几轮，可审计
 *
 * 默认摘要器是确定性的（纯文本抽取，不调模型），
 * 想用大模型写摘要就传 summarizer: async (events) => string。
 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** 粗估 token：中日韩字符算 1，其他按 1/3.5 估 */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 3.5);
}

export const COMPACT_DEFAULTS = {
  windowTokens: 128000,
  thresholdRatio: 0.3,
  keepTurns: 10,
  pruner: { thresholdChars: 8000, headChars: 6000, tailChars: 1500 },
  summaryMaxChars: 1500,
  marker: '\n…（中段已省略，原文可用 expand 取回）…\n',
};

/** 工具输出掐头去尾（返回新数组，不改原事件） */
export function pruneToolResults(events, options = {}) {
  const { thresholdChars, headChars, tailChars, marker } = { ...COMPACT_DEFAULTS.pruner, ...options };
  const out = [];
  let pruned = 0;
  let savedChars = 0;
  for (const e of events) {
    const text = String(e?.text ?? e?.content ?? '');
    const isTool = e?.role === 'tool' || e?.role === 'tool_result' || e?.kind === 'tool-result';
    if (!isTool || text.length <= thresholdChars) { out.push(e); continue; }
    const head = text.slice(0, headChars);
    const tail = text.slice(-tailChars);
    const next = { ...e, text: `${head}${marker}${tail}`, pruned: true, originalChars: text.length };
    if ('content' in e && !('text' in e)) next.content = next.text;
    savedChars += text.length - next.text.length;
    pruned += 1;
    out.push(next);
  }
  return { events: out, pruned, savedChars };
}

/** 把事件切成"轮"：user 消息开头算一轮 */
export function splitTurns(events) {
  const turns = [];
  let current = null;
  for (const e of events) {
    const isUser = e?.role === 'user' || e?.kind === 'user-message' || e?.type === 'turn/start';
    if (isUser || !current) {
      if (current) turns.push(current);
      current = [e];
    } else current.push(e);
  }
  if (current) turns.push(current);
  return turns;
}

const KEY_RE = /(承诺|决定|说好|以后|不准|不许|规则|偏好|喜欢|讨厌|答应|约定|边界)/;

/** 默认摘要器：确定性抽取，不调模型 */
export function extractiveSummary(events, { maxChars = COMPACT_DEFAULTS.summaryMaxChars } = {}) {
  const textOf = (e) => String(e?.text ?? e?.content ?? '').replace(/\s+/g, ' ').trim();
  const userLines = [];
  const keyLines = [];
  for (const e of events) {
    const t = textOf(e);
    if (!t) continue;
    if (e?.role === 'user') userLines.push(t.slice(0, 120));
    if (KEY_RE.test(t)) keyLines.push(t.slice(0, 160));
  }
  const uniq = (arr, n) => [...new Set(arr)].slice(-n);
  const parts = [];
  const u = uniq(userLines, 12);
  const k = uniq(keyLines, 12);
  if (u.length) parts.push(`【说过的事】\n${u.map((x) => `- ${x}`).join('\n')}`);
  if (k.length) parts.push(`【关键约定 / 决定】\n${k.map((x) => `- ${x}`).join('\n')}`);
  const body = parts.join('\n\n') || '（这段时间没有可抽取的内容）';
  return body.slice(0, maxChars);
}

function renderSummaryBlock(summary, anchors, fromSeq, toSeq) {
  const anchorText = anchors.length ? anchors.join(', ') : '(无)';
  return [
    '【压缩摘要｜可回溯】',
    summary,
    '',
    `原始事件 id：${anchorText}`,
    `覆盖范围：${fromSeq ?? '?'} ~ ${toSeq ?? '?'}`,
    '（这是摘要，不是原话；需要核对原文时用 expand(record) 取回。）',
  ].join('\n');
}

export class Compactor {
  constructor(options = {}) {
    this.options = { ...COMPACT_DEFAULTS, ...options, pruner: { ...COMPACT_DEFAULTS.pruner, ...(options.pruner || {}) } };
    this.summarizer = options.summarizer || null;
    this.records = [];
  }

  count(events) {
    return events.reduce((sum, e) => sum + estimateTokens(e?.text ?? e?.content ?? ''), 0);
  }

  /**
   * 压缩入口。
   * @returns {{compacted:boolean, events:Array, beforeTokens:number, afterTokens:number,
   *            shadowed?:Array, anchors?:Array, summary?:string, pruned?:number, savedChars?:number}}
   */
  async compact(events = []) {
    const o = this.options;
    const pruned = pruneToolResults(events, o.pruner);
    const prunedTokens = this.count(pruned.events);
    const budget = Math.max(1, Math.floor(o.windowTokens * o.thresholdRatio));

    const base = {
      compacted: false,
      events: pruned.events,
      beforeTokens: this.count(events),
      afterTokens: prunedTokens,
      pruned: pruned.pruned,
      savedChars: pruned.savedChars,
    };

    if (prunedTokens <= budget) return base;

    const turns = splitTurns(pruned.events);
    if (turns.length <= o.keepTurns) {
      // 轮数不够拆，只能靠剪工具输出；返回真实占用让调用方决定
      return { ...base, note: '轮数不足，未折叠（可调大 keepTurns 或先剪工具输出）' };
    }

    const keep = turns.slice(-o.keepTurns).flat();
    const fold = turns.slice(0, turns.length - o.keepTurns).flat();
    const anchors = fold.map((e) => e?.id).filter((x) => x !== undefined && x !== null).map(String);
    const summary = this.summarizer
      ? String(await this.summarizer(fold, { estimateTokens, maxChars: o.summaryMaxChars }))
      : extractiveSummary(fold, { maxChars: o.summaryMaxChars });

    const firstSeq = fold[0]?.seq ?? fold[0]?.id;
    const lastSeq = fold[fold.length - 1]?.seq ?? fold[fold.length - 1]?.id;
    const block = {
      role: 'system',
      kind: 'compaction-summary',
      text: renderSummaryBlock(summary, anchors, firstSeq, lastSeq),
      anchors,
      fromSeq: firstSeq,
      toSeq: lastSeq,
    };

    let summaryText = summary;
    let blockText = block.text;
    let nextEvents = [block, ...keep];
    let afterTokens = this.count(nextEvents);

    // 摘要本身也可能比原文长（窗口很小时）。压缩必须真的变小，否则宁可跳过。
    if (afterTokens >= prunedTokens) {
      const keepTokens = this.count(keep);
      const room = Math.max(0, prunedTokens - keepTokens - 80); // 留一点给锚点与抬头
      if (room > 20) {
        summaryText = summary.slice(0, room);
        blockText = renderSummaryBlock(summaryText, anchors, firstSeq, lastSeq);
        nextEvents = [{ ...block, text: blockText }, ...keep];
        afterTokens = this.count(nextEvents);
      }
    }
    if (afterTokens >= prunedTokens) {
      return { ...base, note: '折叠后没有变小，已跳过（窗口太小或摘要太长）' };
    }

    const record = {
      at: Date.now(),
      beforeTokens: base.beforeTokens,
      afterTokens: this.count(nextEvents),
      foldedEvents: fold.length,
      keptTurns: o.keepTurns,
      anchors,
      summary: summaryText,
      shadowed: fold, // 原文默认还给调用方，存哪儿由他们决定
    };
    this.records.push(record);

    return {
      compacted: true,
      events: nextEvents,
      beforeTokens: record.beforeTokens,
      afterTokens: record.afterTokens,
      shadowed: fold,
      anchors,
      summary: summaryText,
      pruned: pruned.pruned,
      savedChars: pruned.savedChars,
    };
  }

  /** 从压缩记录里取回被折叠的原文 */
  expand(record) {
    if (!record) return [];
    if (Array.isArray(record.shadowed)) return record.shadowed;
    return [];
  }

  /** 审计：每次压缩放掉多少、留几轮 */
  stats() {
    return this.records.map((r) => ({
      at: new Date(r.at).toLocaleString('zh-CN', { hour12: false }),
      beforeK: Math.round(r.beforeTokens / 1000),
      afterK: Math.round(r.afterTokens / 1000),
      freedK: Math.max(0, Math.round((r.beforeTokens - r.afterTokens) / 1000)),
      folded: r.foldedEvents,
      keptTurns: r.keptTurns,
    }));
  }
}

export function createCompactor(options) {
  return new Compactor(options);
}
