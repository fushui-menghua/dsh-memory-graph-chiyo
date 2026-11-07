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

// 多进程写锁：目录级 .lock（mkdir 是原子的），超时自动清理
function sleepSync(ms) {
  const arr = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(arr, 0, 0, ms);
}
function acquireLock(lockDir, { timeoutMs = 3000, staleMs = 10000 } = {}) {
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lockDir); return () => { try { fs.rmdirSync(lockDir); } catch {} }; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const st = fs.statSync(lockDir);
        if (Date.now() - st.mtimeMs > staleMs) { try { fs.rmdirSync(lockDir); } catch {} continue; }
      } catch {}
      if (Date.now() - start > timeoutMs) throw new Error('记忆库被另一个进程锁住了（等待超时）');
      sleepSync(15);
    }
  }
}

export class JsonlStore {
  constructor({ dir }) {
    if (!dir) throw new Error('JsonlStore 需要 dir');
    this.dir = path.resolve(dir);
    this._cache = new Map(); // scope → { files, rows }
  }

  scopeDir(scope) {
    return path.join(this.dir, scope.replace(/[^\w.-]+/g, '_'));
  }

  monthKey(at = Date.now()) {
    const d = new Date(at);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  append(scope, record) {
    this.appendMany(scope, [record]);
    return record;
  }

  /** 一次锁、一次写、一次缓存更新：批量写比逐条快一个数量级 */
  appendMany(scope, records = []) {
    const list = (Array.isArray(records) ? records : []).filter(Boolean);
    if (!list.length) return 0;
    const dir = this.scopeDir(scope);
    fs.mkdirSync(dir, { recursive: true });
    const byMonth = new Map();
    for (const r of list) {
      const key = this.monthKey(r.updatedAt ?? Date.now());
      const arr = byMonth.get(key) || [];
      arr.push(r);
      byMonth.set(key, arr);
    }
    const release = acquireLock(path.join(dir, '.lock'));
    try {
      for (const [month, arr] of byMonth) {
        const file = path.join(dir, `${month}.jsonl`);
        fs.appendFileSync(file, arr.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      }
    } finally {
      release();
    }
    // 就地更新缓存，避免下一次 load 重新解析全部历史
    const cached = this._cache.get(scope);
    if (cached) {
      const byId = new Map(cached.rows.map((r) => [r.id, r]));
      for (const r of list) {
        if (!r?.id) continue;
        const prev = byId.get(r.id);
        if (!prev || Number(r.updatedAt ?? 0) >= Number(prev.updatedAt ?? 0)) byId.set(r.id, r);
      }
      const names = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort();
      cached.rows = [...byId.values()];
      cached.stamp = this._stamp(dir, names);
    }
    return list.length;
  }

  _stamp(dir, names) {
    return names.map((name) => {
      try { const st = fs.statSync(path.join(dir, name)); return name + ':' + st.size + ':' + st.mtimeMs; } catch { return name + ':?'; }
    }).join('|');
  }

  /** 读一个 scope 的全部记录，按 id 做 last-wins 合并（带 mtime 缓存） */
  load(scope) {
    const dir = this.scopeDir(scope);
    if (!fs.existsSync(dir)) return [];
    // 缓存：只要目录里的文件没增删改，就不重新解析
    let stamp = '';
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort();
      stamp = this._stamp(dir, names);
    } catch { return []; }
    const cached = this._cache.get(scope);
    if (cached && cached.stamp === stamp) return cached.rows.slice();
    const byId = new Map();
    for (const name of names) {
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
    const rows = [...byId.values()];
    this._cache.set(scope, { stamp, rows });
    return rows.slice();
  }

  listScopes() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.replace(/_/g, ':'));
  }
}
