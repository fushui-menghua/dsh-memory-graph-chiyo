/**
 * store.js —— 极简 JSONL 存储（last-wins）
 *
 * 为什么不用数据库：
 *   - 记忆是"只追加、按 id 取最新一条"的模型，JSONL 天然适合
 *   - 崩溃后最多丢最后一行，不会像 sqlite 那样出现半事务
 *   - 用户能直接 grep 自己的记忆（可审计 > 性能）
 *
 * 目录结构：
 *   <dir>/<scope>/<YYYY-MM>.jsonl
 *   scope 形如 user:alice / agent:chiyo / project:demo
 */
import fs from 'node:fs';
import path from 'node:path';

export class JsonlStore {
  constructor({ dir }) {
    if (!dir) throw new Error('JsonlStore 需要 dir');
    this.dir = path.resolve(dir);
  }

  scopeDir(scope) {
    return path.join(this.dir, scope.replace(/[^\w.-]+/g, '_'));
  }

  monthKey(at = Date.now()) {
    const d = new Date(at);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  append(scope, record) {
    const dir = this.scopeDir(scope);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.monthKey(record.updatedAt ?? Date.now())}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    return record;
  }

  /** 读一个 scope 的全部记录，按 id 做 last-wins 合并 */
  load(scope) {
    const dir = this.scopeDir(scope);
    if (!fs.existsSync(dir)) return [];
    const byId = new Map();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      let text = '';
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (!rec?.id) continue;
        const prev = byId.get(rec.id);
        if (!prev || Number(rec.updatedAt ?? 0) >= Number(prev.updatedAt ?? 0)) byId.set(rec.id, rec);
      }
    }
    return [...byId.values()];
  }

  listScopes() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.replace(/_/g, ':'));
  }
}
