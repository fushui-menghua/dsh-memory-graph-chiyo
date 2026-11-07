/**
 * assemble.js —— 把召回结果拼成可直接塞进提示词的块
 *
 * recall 负责"找出来"，这里负责"用得上"：
 *   · 按 token 预算裁剪（不是按条数）
 *   · 分层优先级：规则/长期 > 普通事实 > 印象 > 计划
 *   · 每条带 id（方便模型引用、也方便你回溯）
 *   · 可附带共享记忆与到期计划
 */
import { estimateTokens } from './compact.js';

const LAYER_ORDER = { permanent: 0, long: 1, short: 2, instant: 3, cold: 4 };
const KIND_ORDER = { fact: 0, plan: 1, impression: 2 };

function lineOf(n) {
  const tag = n.layer && n.layer !== 'short' ? `[${n.layer}]` : '';
  const id = n.id ? `(${n.id.slice(0, 8)})` : '';
  return `- ${tag}${n.text} ${id}`.trim();
}

export function assembleContext(memory, {
  scopes = [],
  query = '',
  tokenBudget = 1200,
  includeShared = true,
  includePlans = true,
  limit = 40,
} = {}) {
  const picked = scopes.length
    ? memory.recallAcross(scopes, { query, limit })
    : [];

  const sorted = [...picked].sort((a, b) => {
    const la = LAYER_ORDER[a.layer] ?? 9;
    const lb = LAYER_ORDER[b.layer] ?? 9;
    if (la !== lb) return la - lb;
    const ka = KIND_ORDER[a.kind] ?? 9;
    const kb = KIND_ORDER[b.kind] ?? 9;
    if (ka !== kb) return ka - kb;
    return Number(b.score || 0) - Number(a.score || 0);
  });

  const parts = [];
  const used = [];
  let tokens = 0;
  const push = (block) => {
    const t = estimateTokens(block);
    if (tokens + t > tokenBudget) return false;
    parts.push(block);
    tokens += t;
    return true;
  };

  const facts = sorted.filter((n) => n.kind === 'fact');
  const plans = includePlans ? sorted.filter((n) => n.kind === 'plan') : [];
  const impressions = sorted.filter((n) => n.kind === 'impression');

  if (facts.length) {
    const lines = [];
    for (const n of facts) {
      const block = lineOf(n);
      if (estimateTokens(lines.join('\n') + '\n' + block) > tokenBudget * 0.7) break;
      lines.push(block);
      used.push(n.id);
    }
    if (lines.length) push(`【记得的事】\n${lines.join('\n')}`);
  }

  if (plans.length) {
    const lines = [];
    for (const n of plans) {
      const block = `${lineOf(n)}${n.validTo ? `（到 ${new Date(n.validTo).toLocaleDateString('zh-CN')}）` : ''}`;
      if (!push(`【在办的事】\n${block}`)) break;
      lines.push(block);
      used.push(n.id);
    }
  }

  if (impressions.length) {
    const lines = [];
    for (const n of impressions) {
      if (!push(`【印象】\n${lineOf(n)}`)) break;
      lines.push(lineOf(n));
      used.push(n.id);
    }
  }

  if (includeShared && typeof memory.recallShared === 'function') {
    try {
      const shared = memory.recallShared({ query, limit: 5 });
      if (shared.length) {
        const lines = shared.map((e) => `- ${e.text}`);
        push(`【共享记忆】\n${lines.join('\n')}`);
      }
    } catch { /* 共享层不可用不影响主流程 */ }
  }

  return { text: parts.join('\n\n'), tokens, used, total: sorted.length };
}
