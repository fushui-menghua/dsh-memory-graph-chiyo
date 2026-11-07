/**
 * conflicts.js —— 矛盾检测（同一件事前后说法不一致）
 *
 * 文本去重只能抓"一字不差"，抓不到"喜欢 → 讨厌"这种翻转。
 * 这里用轻量规则判断：
 *   · 主语相同（去掉极性词后相似度 ≥ 阈值）
 *   · 极性相反（喜欢/爱/要 vs 不喜欢/讨厌/不要/怕）
 *   · 类别相同
 * → 旧的那条标 superseded（不删除，可查），召回默认只给新的。
 */
import { normalizeText, similarity } from './core.js';

const NEG_RE = /(不喜欢|不爱|不想要|不要|不想|讨厌|讨厌死|受不了|害怕|不敢|不会|不是)/;
const POS_RE = /(喜欢|爱上|爱|想要|要|想买|会|是|打算|准备)/;

/** 去掉极性词与常见虚词，留下"在讲什么" */
export function subjectOf(text) {
  return normalizeText(text)
    .replace(/不喜欢|不爱|不想要|不要|不想|讨厌死|讨厌|受不了|害怕|不敢|不会|不是/g, '')
    .replace(/喜欢|爱上|爱|想要|想买|打算|准备|觉得|有点|比较|很|挺|太|了|的|吧|呢|啊/g, '');
}

export function polarityOf(text) {
  const s = String(text ?? '');
  if (NEG_RE.test(s)) return 'neg';
  if (POS_RE.test(s)) return 'pos';
  return 'neutral';
}

/**
 * 找出一条新记忆跟已有记忆的冲突。
 * @returns {{old: object, polarityNew: string, polarityOld: string} | null}
 */
export function findConflict(existing, candidate, { minSubjectSim = 0.6 } = {}) {
  const text = String(candidate.text ?? '');
  const polNew = polarityOf(text);
  if (polNew === 'neutral') return null;
  const subjNew = subjectOf(text);
  if (subjNew.length < 2) return null;
  for (const old of existing) {
    if (old.archived || old.superseded) continue;
    if (old.kind !== 'fact' || candidate.kind !== 'fact') continue;
    if ((old.category || 'topic') !== (candidate.category || 'topic')) continue;
    const polOld = polarityOf(old.text);
    if (polOld === 'neutral' || polOld === polNew) continue;
    const sim = similarity(subjNew, subjectOf(old.text));
    if (sim >= minSubjectSim) return { old, polarityNew: polNew, polarityOld: polOld };
  }
  return null;
}

/** 批量扫描：把历史里已经存在的矛盾标出来（用于老数据） */
export function scanConflicts(graph, scope, { apply = false, minSubjectSim = 0.6 } = {}) {
  const nodes = graph.load(scope).filter((n) => !n.archived && !n.superseded && n.kind === 'fact');
  const found = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      const a = nodes[j];
      const b = nodes[i];
      // 只让"更新的一条"压"更旧的一条"
      const newer = Number(b.createdAt || 0) >= Number(a.createdAt || 0) ? b : a;
      const older = newer === b ? a : b;
      const hit = findConflict([older], newer, { minSubjectSim });
      if (!hit) continue;
      if (found.some((f) => f.oldId === older.id && f.newId === newer.id)) continue;
      found.push({ oldId: older.id, newId: newer.id, oldText: String(older.text).slice(0, 40), newText: String(newer.text).slice(0, 40) });
      if (apply) {
        const at = Date.now();
        graph.store.append(scope, { ...older, superseded: true, supersededBy: newer.id, supersededAt: at, updatedAt: at });
        graph.store.append(scope, { ...newer, supersedes: older.id, updatedAt: at });
      }
      break;
    }
  }
  return found;
}
