/**
 * rules.js —— 从对话里认出"规矩"和"承诺"
 *
 * 她那边真正让记忆有用的一步：不是等模型总结，而是从原话里识别
 *   · 你定的规矩（"以后别在深夜发消息"）
 *   · 她自己的承诺（"我以后先自己验一遍"）
 * 然后写成带锚点的规则节点，永远优先召回。
 *
 * 这个模块只做"识别 + 转成待写入节点"，落盘仍走 graph.write（带锚点校验）。
 */
export const RULE_PATTERNS = {
  owner: [
    /以后(?:不要|别|不准|不许|必须|要)/,
    /记住[，,]?\s*(?:以后|下次|不要再)/,
    /(?:不准|不许|不要)(?:再)?(?:这样|这么)/,
    /规矩|约定|说好/,
  ],
  self: [
    /我(?:以后|下次|之后)(?:会|要|先|都|也)/,
    /(?:我)?答应(?:你|过)/,
    /我(?:一定|保证)(?:会|做到)/,
  ],
};

export const PROMISE_HINT = /(以后|下次|再也不|一定|保证|说好|约定|规矩)/;

/** 判断一句话属于哪一类规则；返回 null 表示不是规则 */
export function classifyRule(text, { speaker = 'owner' } = {}) {
  const s = String(text ?? '').trim();
  if (s.length < 4) return null;
  const selfHit = RULE_PATTERNS.self.some((re) => re.test(s));
  const ownerHit = RULE_PATTERNS.owner.some((re) => re.test(s));
  if (speaker === 'self' && selfHit) return 'rule-self';
  if (speaker === 'owner' && ownerHit) return 'rule-owner';
  // 说话人没标清时，靠主语判断
  if (/^我(?:以后|下次|答应|保证)/.test(s)) return 'rule-self';
  if (ownerHit) return 'rule-owner';
  return null;
}

/**
 * 从一段消息里抽规则节点（可直接塞给 graph.write）。
 * @returns {Array<{kind,text,category,cluster,anchors}>}
 */
export function extractRules(text, { speaker = 'owner', at, max = 3 } = {}) {
  const raw = String(text ?? '');
  // 按句切，长句也能拆出多条规矩
  const sentences = raw.split(/[。！？!?\n]/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    const cluster = classifyRule(s, { speaker });
    if (!cluster) continue;
    out.push({
      kind: 'fact',
      text: s.slice(0, 200),
      category: 'preference',
      cluster,
      anchors: [{ quote: s.slice(0, 200), source: speaker === 'self' ? '自我承诺' : '主人原话', at }],
    });
    if (out.length >= max) break;
  }
  // 整段也算一次（有时一句话被标点拆碎了，整段仍带"以后/规矩"）
  if (!out.length && PROMISE_HINT.test(raw) && raw.length >= 6) {
    const cluster = classifyRule(raw, { speaker });
    if (cluster) {
      out.push({ kind: 'fact', text: raw.slice(0, 200), category: 'preference', cluster, anchors: [{ quote: raw.slice(0, 200), source: speaker === 'self' ? '自我承诺' : '主人原话', at }] });
    }
  }
  return out;
}
