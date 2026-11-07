# Changelog

## 0.6.0 — 2026-11-07

收口这一版，目标是"别人敢用"。

### 新增

- **矛盾检测**（`conflicts.js`）
  - 同一类别下"喜欢 / 不喜欢"这类极性翻转 → 旧的标 `superseded`，召回默认只给新的
  - `scanConflicts()` 批量扫描历史遗留矛盾
  - `includeSuperseded` 可以显式把旧说法也召回
- **多进程写锁**：`store.append` 走目录级 `.lock`（mkdir 原子），等待超时 3s，10s 的陈旧锁自动清理
- **损坏修复**（`repair.js`）：`scanStore` 只检查，`repairStore({apply:true})` 删坏行并备份原文件
- **TypeScript 声明**：手写 `index.d.ts`，覆盖全部主要 API
- **性能优化**
  - 批量写：`appendMany` 一次锁一次写
  - 缓存就地更新：写入后不再让整个 scope 缓存失效
  - bigram 缓存：召回时不再重复切词
  - 召回回写节流：30 秒内同一节点不重复累加 `recallCount`
- **基准** `bin/bench.mjs`：2000 节点实测写入 ~1400 条/s、纯召回 0.42ms/次
- **CLI**：`scan` / `repair` 命令

### 测试

39 → **47**

## 0.5.0 — 2026-11-07

把「记忆存储」补成「能接进 agent 的记忆系统」，同时补工程化。

### 新增

- `extractor.js`：从对话自动抽记忆
  - `heuristicExtract(messages)`：规则 + 事实启发式，零模型
  - `extractAndWrite(memory, scope, messages)`：过滤敏感 → 校验锚点 → 幂等去重 → 落盘
  - `buildExtractionPrompt(messages)`：给大模型抽取用的提示词
- `assemble.js`：按 **token 预算**把召回结果拼成提示词块（事实 / 在办的事 / 印象 / 共享记忆分区，带 id）
- `snapshot.js`：整个数据目录导出成**单个 JSON 包**，可导入还原（换机器、误删恢复）
- `SharedMemory`
  - 每日提名配额（默认 3 条/天）
  - `dependsOn` 依赖 + 撤销时**级联撤销**下游
  - 审计日志（`propose` / `approve` / `revoke`，独立 `shared:audit` 作用域）
- `JsonlStore` 内存缓存：按文件 mtime 失效，写入后自动失效，避免每次召回全量解析
- 关系边强度：`relations[].weight` + `decayRelations()`（默认半年半衰期，低于阈值摘边）
- 人物关联：`relations[].type === 'person'` 可指向人物层记录（`options.personIds` 白名单）
- GitHub Actions：Node 20/22/24 三版本跑测试

### 测试

31 → **39** 个

## 0.4.0 — 2026-11-07

- 规则抽取（主人规矩 / 她自己的承诺）
- 敏感内容过滤（路径 / QQ号 / 凭据 / 令牌）
- 锚点强校验（引文必须真的在原文里）
- 幂等键去重（`idempotencyKey` / `mentionKey`）
- 人物层（登记 / 别名 / 合并审批）
- 时段轨迹 + 漏检扫描
- 六项体检
- 人格旋钮（六旋钮 + 三重刹车，角色扮演层）
- 星图可视化（SVG + Mermaid）

## 0.3.0 — 2026-11-07

- 带锚点的上下文压缩（prune / compact / stats，`expand()` 可取回原文）
- 保证「压缩必须变小」的保护

## 0.2.0 — 2026-11-07

- 跨 scope 召回（合并打分、带来源）
- 共享记忆（propose → approve → revoke）
- plan 生命周期（`validTo` 过期）
- 关系边（6 种类型，召回可沿边扩展）
- 夜间入口 `nightly()`
- 命令行 `bin/cli.mjs`

## 0.1.0 — 2026-11-07

- 图记忆内核：锚点强制、四层衰减、写入去重、重要度、召回
- 即时记忆（6h 醒 / 6h 睡 / 墓碑 / 复活升级）
- 夜间整理 + 体检
- JSONL 存储（last-wins、按月分片）
