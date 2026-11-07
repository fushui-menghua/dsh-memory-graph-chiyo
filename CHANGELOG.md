# Changelog

## 1.0.1 — 2026-11-07

### 修复
- `dreamTick()` 做梦时间窗在非本地时区的机器上算错（GitHub CI 是 UTC，凌晨 3 点被算成 19 点）
  - 现在支持显式 `hour` 与 IANA `timeZone`，默认仍用本机时区
- 对应测试不再依赖运行机器的时区


## 1.0.0 — 2026-11-07

除唤醒/潜水调度外，记忆能力对齐线上系统。

### 新增
- `src/backfill.js`：补录协议（只允许 fact、一次≤2 条、证据三元组、整批原子、召回权重 0.8）
- `src/access.js`：权限模型（主人/agent/群/陌生人 × scope 模式，read/write 分离）
- `src/galaxy.js`：**完整版星图**——单文件可交互 HTML（缩放/拖拽/按层过滤/搜索/点节点看锚点与关系），离线可用
- `bin/recall-eval.mjs`：召回基线评测（hit@1 / hit@3）
- `person.js`：熟悉度字段 + 增长/半衰期衰减 + **合并后关系重指**
- `bridge.js`：
  - `observe({role,text})` 逐条喂消息，assistant 到达自动抽取
  - `dreamTick()` 做梦时间窗 + 素材 + 提示词（不负责定时）
  - `plan()` 待办节拍：挑下一件并标 doing，返回建议间隔
- CLI 新增 `galaxy` 命令导出交互式星图

### 修复
- `core.write` 透传 `origin` / `originWeight` / `backfillEvidence`（之前补录元数据会丢）
- 关系可指向 `p_` 开头的人物记录（之前只认同 scope 节点）

### 测试
61 → **67**

## 0.9.0 — 2026-11-07

补齐最后三块「人格陪伴」能力：情绪、做梦、待办。

### 新增
- `src/emotions.js`：情绪记忆层
  - `mood.set()` 记一次心情（含原因、强度、标签）
  - `mood.current()` 当前心情（超过 48h 视为没记录）
  - `mood.history()` / `mood.summary()` 时间线与近七天分布
  - `mood.tagMemory()` 给记忆打情绪标签（带锚点）
- `src/dream.js`：做梦
  - `dream.seed()` 从记忆里挑入梦素材（优先带锚点、有重要度的）
  - `dream.buildPrompt()` 生成给模型写梦的提示词；`templateDream()` 无模型时的确定性版本
  - `dream.record()` / `list()` / `latest()` 记录与回看（梦里引用了哪些记忆也存）
- `src/tasks.js`：自己的待办
  - `tasks.add()` / `done()` / `drop()` / `pickNext()` / `stats()` / `summary()`
- 桥接适配层同步暴露：`bm.mood` / `bm.dream` / `bm.tasks`

### 说明
- 这些是**可选模块**：不用就不调用，不影响原有记忆能力
- 不做定时唤醒（那是调度层的事），只提供数据与挑选逻辑

### 测试
56 → **61**

## 0.8.0 — 2026-11-07

定位收敛：**面向桥接场景的人格机器人记忆层**。

### 新增
- `src/bridge.js`：桥接适配层 `createBridgeMemory()`
  - `beforeTurn({ query })` → 返回要拼进提示词的记忆块（按 token 预算）
  - `afterTurn({ messages, speaker })` → 自动抽取落盘（规则兜底，不调模型）
  - `nightly({ apply })` / `health()` / `recall()` / `write()`
  - 记忆层抛错不影响对话（都包了 try/catch）
- `docs/BRIDGE.md`：桥接三步接入说明
- 导出子路径 `./bridge`

### 修复
- `cordis.patch.yml` 的 `name` 改为 `dsh-memory-graph-chiyo/plugin`
  - 之前指向包根（`src/index.js`，是库，没有 `apply`），DSH 静默跳过不挂载
  - 已在本地 0.7.1 验证：数据目录会被创建、5 个工具能注册

### 测试
51 → **56**（新增桥接适配 5 个）

## 0.7.0 — 2026-11-07

从「库」变成「既能 import、也能装进 DSH 的插件」。

### 新增
- `plugin.js`：DSH 插件入口，`apply(ctx, config)` 注册 5 个工具
  - `memory_write` 写记忆（带锚点）
  - `memory_recall` 召回
  - `memory_health` 体检
  - `memory_nightly` 夜间整理（默认 dry-run）
  - `memory_shared` 共享记忆（list/propose/approve/revoke）
- `cordis.patch.yml`：bundle patch，profile 列出包名即挂载
- `package.json` 增加 `dsh.bundle.patch`、`exports["./plugin"]`、`engines.dsh`
- 数据目录默认 `~/.dsh/memory-graph`，默认 scope `agent:memory`

### 兼容
- 没有 `dsh-tools` 时用内置 `defineTool` 兜底（参数映射自动转 JSON Schema）
- 单个工具注册失败不影响其它工具

### 测试
47 → **51**（新增插件注册、schema、体检/夜间、共享流程）

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
