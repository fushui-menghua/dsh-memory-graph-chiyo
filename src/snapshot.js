/**
 * snapshot.js —— 导入导出与快照回滚
 *
 * 记忆是长期资产，最怕两件事：换机器搬不过去、误删找不回来。
 * 这里把整个数据目录打成**一个 JSON 文件**（而不是 tar/zip），
 * 好处是能直接看、能 diff、能塞进任何备份系统。
 */
import fs from 'node:fs';
import path from 'node:path';

export function exportBundle(dir, { note = '' } = {}) {
  const root = path.resolve(dir);
  const files = [];
  const walk = (d, base = '') => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else files.push({ path: rel, text: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return {
    format: 'dsh-memory-graph-chiyo/bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    note,
    files,
  };
}

export function importBundle(bundle, dir, { overwrite = false } = {}) {
  if (!bundle || bundle.format !== 'dsh-memory-graph-chiyo/bundle') {
    throw new Error('不是本项目的记忆包（format 不匹配）');
  }
  const root = path.resolve(dir);
  let written = 0;
  let skipped = 0;
  for (const f of bundle.files || []) {
    const target = path.join(root, f.path);
    if (!target.startsWith(root)) throw new Error(`包里有越界路径：${f.path}`);
    if (!overwrite && fs.existsSync(target)) { skipped += 1; continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(f.text ?? ''), 'utf8');
    written += 1;
  }
  return { written, skipped, dir: root };
}

export function saveBundle(bundle, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  return file;
}

export function loadBundle(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}
