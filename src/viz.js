/**
 * viz.js —— 星图可视化（零依赖 SVG）
 *
 * 为什么不塞前端：这份输出是**字符串**，你可以直接存成 .svg 丢进 README、
 * 放进网页、或者当邮件附件发出去。想要交互式的自己接 d3/cytoscape。
 *
 * 画法：同心圆按层排布（instant 最内圈 → permanent 最外圈），
 * 关系边画直线，颜色区分 kind，图例带计数。
 */
import { LAYERS, KINDS } from './core.js';

const KIND_COLOR = {
  fact: '#4C8BF5',
  impression: '#9C6ADE',
  plan: '#F5A623',
  instant: '#4CD1B1',
};

const LAYER_LABEL = {
  instant: '即时',
  short: '短期',
  long: '长期',
  cold: '冷层',
  permanent: '永久',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderStarMap(nodes = [], { width = 960, height = 640, title = '记忆星图', showLabels = true } = {}) {
  const cx = width / 2;
  const cy = height / 2;
  const rings = ['instant', 'short', 'long', 'cold', 'permanent'];
  const maxR = Math.min(width, height) / 2 - 60;

  // 按层分组
  const groups = new Map();
  for (const n of nodes.filter((x) => !x.archived)) {
    const layer = LAYERS.includes(n.layer) ? n.layer : 'short';
    const arr = groups.get(layer) || [];
    arr.push(n);
    groups.set(layer, arr);
  }
  const counts = Object.fromEntries(rings.map((r) => [r, (groups.get(r) || []).length]));

  const pos = new Map();
  const parts = [];
  rings.forEach((layer, idx) => {
    const arr = groups.get(layer) || [];
    const r = maxR * ((idx + 1) / rings.length);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#e5e7eb" stroke-dasharray="4 6"/>`);
    parts.push(`<text x="${cx + r - 8}" y="${cy - 6}" fill="#9ca3af" font-size="11">${LAYER_LABEL[layer]} ${arr.length}</text>`);
    arr.forEach((n, i) => {
      const angle = (i / Math.max(1, arr.length)) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      pos.set(n.id, { x, y, n });
    });
  });

  // 关系边
  const edges = [];
  for (const n of nodes) {
    for (const rel of n.relations || []) {
      const a = pos.get(n.id);
      const b = pos.get(rel.targetId);
      if (!a || !b) continue;
      edges.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#cbd5e1" stroke-width="1"/>`);
    }
  }

  // 节点
  const dots = [];
  for (const { x, y, n } of pos.values()) {
    const color = KIND_COLOR[n.kind] || '#94a3b8';
    const r = n.kind === 'fact' ? 5 : 4;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}"><title>${esc(String(n.text).slice(0, 80))}</title></circle>`);
    if (showLabels) {
      dots.push(`<text x="${(x + 7).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#475569">${esc(String(n.text).slice(0, 14))}</text>`);
    }
  }

  // 图例
  const legend = KINDS.map((k, i) => {
    const n = nodes.filter((x) => x.kind === k && !x.archived).length;
    return `<g transform="translate(16,${20 + i * 18})"><circle r="5" fill="${KIND_COLOR[k] || '#94a3b8'}"/><text x="12" y="4" font-size="11" fill="#334155">${k} ${n}</text></g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${cx}" y="30" text-anchor="middle" font-size="16" fill="#111827">${esc(title)}</text>
  ${parts.join('\n  ')}
  ${edges.join('\n  ')}
  ${dots.join('\n  ')}
  ${legend}
  <text x="${width - 16}" y="${height - 14}" text-anchor="end" font-size="11" fill="#9ca3af">节点 ${pos.size} · 边 ${edges.length} · ${new Date().toLocaleDateString('zh-CN')}</text>
</svg>`;
}

/** 另一个轻量格式：Mermaid（GitHub README 原生渲染） */
export function renderMermaid(nodes = [], { maxNodes = 40 } = {}) {
  const live = nodes.filter((n) => !n.archived).slice(0, maxNodes);
  const ids = new Map(live.map((n, i) => [n.id, `N${i}`]));
  const lines = ['graph TD'];
  for (const n of live) {
    const label = String(n.text).slice(0, 24).replace(/["\n]/g, ' ');
    lines.push(`  ${ids.get(n.id)}["${label}"]`);
  }
  for (const n of live) {
    for (const rel of n.relations || []) {
      if (!ids.has(rel.targetId)) continue;
      lines.push(`  ${ids.get(n.id)} -->|${rel.type}| ${ids.get(rel.targetId)}`);
    }
  }
  return lines.join('\n');
}
