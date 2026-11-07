/**
 * repair.js —— 数据体检与损坏修复
 *
 * JSONL 最怕两件事：断电写了半行、手工编辑留下坏行。
 * 这里给两个命令式函数：scan 只看，repair 才动（默认先备份）。
 */
import fs from 'node:fs';
import path from 'node:path';

function walkJsonl(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; } // 没权限的目录直接跳过
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, out);
    else if (e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** 扫描：返回每个文件的坏行数与样例 */
export function scanStore(dir) {
  const root = path.resolve(dir);
  const files = walkJsonl(root);
  const report = { dir: root, files: files.length, badFiles: 0, badLines: 0, details: [] };
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let bad = 0;
    let lastBadPreview = '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { JSON.parse(line); } catch { bad += 1; lastBadPreview = line.slice(0, 80); }
    }
    if (bad) {
      report.badFiles += 1;
      report.badLines += bad;
      report.details.push({ file: path.relative(root, file), bad, preview: lastBadPreview });
    }
  }
  return report;
}

/** 修复：删掉坏行，原文件备份成 .bak-<时间戳> */
export function repairStore(dir, { apply = false } = {}) {
  const root = path.resolve(dir);
  const report = scanStore(root);
  if (!apply) return { ...report, applied: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fixed = [];
  for (const d of report.details) {
    const file = path.join(root, d.file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const good = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { JSON.parse(line); good.push(line); } catch { /* 丢掉坏行 */ }
    }
    fs.copyFileSync(file, `${file}.bak-${stamp}`);
    fs.writeFileSync(file, good.join('\n') + (good.length ? '\n' : ''), 'utf8');
    fixed.push({ file: d.file, removed: d.bad, kept: good.length });
  }
  return { ...report, applied: true, fixed };
}
