# dsh-memory-graph-chiyo

> 可回溯、会遗忘、会睡觉整理的记忆内核。给 AI agent 用的长期记忆图。

[![tests](https://img.shields.io/badge/tests-51%20passing-brightgreen)](https://github.com/fushui-menghua/dsh-memory-graph-chiyo)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/fushui-menghua/dsh-memory-graph-chiyo/blob/main/LICENSE)

## 为什么又一个记忆库

现在的开源记忆方案大致五条路（2026 年现状）：

| 路线 | 代表 | 记忆形态 | 检索 | 短板 |
|---|---|---|---|---|
| A. 向量 RAG | 传统向量库 | 文本块 | 向量相似 | 谁说的、什么时候、还算不算数，全丢 |
| B. 抽取 + 混合检索 | Mem0 | 结构化事实卡 | 语义+关键词+实体 | 事实是模型重写的，**原文不可回溯** |
| C. 时序知识图谱 | Zep / Graphiti | 实体关系图 + 时间区间 | 图遍历 + 时间过滤 | 状态变化处理最强，但重 |
| D. OS 分层记忆 | Letta / MemGPT | 内存页 + 归档 | 模型自己搬页 | 依赖模型自律，容易漂 |
| E. 本体图谱 | Cognee | 本体 + 图 | 图查询 | 要设计 schema，接入成本高 |

**本项目走 B+C 的混合，但多三件事：**

1. **锚点强制（anchors）** —— fact / plan 必须能指回原话片段，否则拒收。
2. **四层衰减** —— instant → short → long → cold；不是只增不减的仓库。
3. **夜间整理（consolidation）** —— 归档重复与墓碑，把提过多次、规则承诺类升层。

一句话：**它记得住，也忘得掉，而且每晚自己整理。**

## 能力清单

| 能力 | 说明 |
|---|---|
| 锚点强制 | `fact`/`plan` 必须带原话；`impression` 可无 |
| 写入即去重 | 规范化文本相同 → 合并 `mentionCount` |
| 四层衰减 | `short`→`long`（提 3 次满 2 天）；长期不用 →`cold` |
| 重要度 | 提及 + 召回 + 锚点 + 类别 + 新鲜度加权，召回即反哺 |
| 召回 | 字符 bigram + 关键词 + 重要度 + 新鲜度；过滤冷层/归档/过期 |
| **跨 scope 召回** | 多 scope 合并打分，结果带 `scope` 来源 |
| **关系边** | `person`/`relationship`/`because`/`derivedFrom`/`supports`/`contradicts`；召回可沿边扩展一跳（进出边都算） |
| **plan 生命周期** | 有 `validTo`，过期自动 `expired`，过期后不再召回 |
| 即时记忆 | 醒 6h → 睡 6h → 墓碑；精确复活；复活 3 次升级成 fact |
| **共享记忆** | propose → approve → 跨会话可见 → revoke；未批准不可召回 |
| 夜间整理 | 归档重复/墓碑/极小陈旧；强化规则承诺类 |
| 体检 | 分层、类别、锚点覆盖率、90 天陈旧数 |
| **上下文压缩（带锚点）** | 超阈值折叠旧轮次 → 摘要 + 锚点 + 原文可 `expand()` 取回；工具输出先掐头去尾 |
| **规则抽取** | 从原话认出「主人定的规矩」和「她自己的承诺」，自动生成带锚点的规则节点 |
| **敏感过滤** | 路径 / QQ号 / 凭据 / 令牌写入前拒收，可逐类放行 |
| **锚点强校验** | 传了原始消息时，引文必须真的在里面，防模型编造 |
| **幂等去重** | `idempotencyKey` / `mentionKey`，同一件事换说法也只记一次 |
| **人物层** | 登记、别名解析、合并提议与审批 |
| **时段轨迹 / 漏检扫描** | 回看某段时间发生了什么；找出没被任何锚点引用过的话 |
| **人格旋钮（可选）** | 六个性格旋钮，带单步/每日/漂移三重刹车（角色扮演层，非记忆） |
| **星图可视化** | 零依赖 SVG + Mermaid 输出，可直接贴 README |
| **自动抽取管道** | `extractAndWrite`：从对话抽规则/事实 → 敏感过滤 → 锚点校验 → 幂等去重 → 落盘 |
| **提示词装配** | `assembleContext`：按 token 预算分区拼装（记得的事/在办的事/印象/共享） |
| **快照导入导出** | 整个数据目录导成单个 JSON，可还原（换机器、误删恢复） |
| **关系强度衰减** | 边有 weight，默认半年半衰期，低于阈值自动摘边 |
| **共享审计与配额** | 每日提名上限、依赖级联撤销、独立审计日志 |
| **store 缓存** | 按文件 mtime 失效，写入即失效，召回不必全量解析 |
| **矛盾检测** | 喜欢/不喜欢这类翻转 → 旧的标 `superseded`，只召回新的 |
| **多进程写锁** | 目录级锁 + 超时 + 陈旧锁清理 |
| **损坏修复** | `scanStore` / `repairStore`，坏行剔除并备份原文件 |
| **TypeScript 类型** | 内置 `index.d.ts` |
| **性能基准** | `npm run bench`：2000 节点写入 ~1400 条/s、召回 0.42ms |
| 命令行 | `memory-graph health/recall/recall-all/nightly/shared-*/scan/repair` |
| 零依赖 | 只用 Node 内置模块 |

## 安装

**作为库（推荐给开发者）**

```bash
npm i dsh-memory-graph-chiyo
```

**作为 DSH 插件（推荐给 DSH 用户）**

```bash
dsh plugin --profile web add dsh-memory-graph-chiyo
```

装上后 DSH 会注册 5 个工具：`memory_write` / `memory_recall` / `memory_health` / `memory_nightly` / `memory_shared`。
数据默认在 `~/.dsh/memory-graph`，默认 scope `agent:memory`（可在 plugin 配置里改）。

> 插件与库是同一个包：`import` 用 `./src/index.js`，DSH 走 `./plugin.js` 的 `apply(ctx)`。


```bash
npm i dsh-memory-graph-chiyo
```

要求 Node ≥ 20。

## 快速开始

```js
import { createMemory } from 'dsh-memory-graph-chiyo';

const mem = createMemory({ dir: './memory-data' });

// 1) 写：fact 必须带锚点
mem.write('user:alice', {
  nodes: [
    { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
    { kind: 'fact', text: '她怕黑', anchors: [{ quote: '我怕黑' }] },
  ],
});

// 2) 建立关系边（目标必须已存在）
const fear = mem.load('user:alice').find((n) => /怕黑/.test(n.text));
mem.write('user:alice', {
  nodes: [{ kind: 'fact', text: '睡觉要留一盏小灯', anchors: [{ quote: '留个灯' }], relations: [{ type: 'because', targetId: fear.id }] }],
});

// 3) 召回（hops=1 沿关系扩展）
const hits = mem.recall('user:alice', { query: '怕黑', hops: 1 });

// 4) 跨 scope 召回
mem.recallAcross(['user:alice', 'agent:chiyo'], { query: '下雨' });

// 5) 计划（3 天后自动过期）
mem.write('user:alice', { nodes: [{ kind: 'plan', text: '周末去看海', anchors: [{ quote: '周末去海边' }], validDays: 3 }] });

// 6) 共享记忆：提名 → 批准 → 可召回
const s = mem.proposeShared({ text: '雨天适合听老唱片', sourceScope: 'group:demo' });
mem.approveShared(s.id, { by: 'owner' });
mem.recallShared({ query: '雨天' });

// 7) 睡一觉：推进层/即时/计划 + 整理 + 体检
const report = mem.nightly(['user:alice', 'agent:chiyo'], { apply: true });
```

## 上下文压缩（带锚点）

普通压缩的毛病：摘要写完，原话就找不回来了。这里给摘要挂 **anchors**（被折叠事件的 id），
被折叠的原文默认从 `shadowed` 返回，随时能取回。

```js
import { createCompactor } from 'dsh-memory-graph-chiyo';

const comp = createCompactor({
  windowTokens: 128000,   // 模型上下文窗口
  thresholdRatio: 0.3,    // 超过 30% 才压
  keepTurns: 10,          // 保留最近 10 轮
  pruner: { thresholdChars: 8000, headChars: 6000, tailChars: 1500 },
  // summarizer: async (events) => '用你的模型写摘要',  // 可选，默认是确定性抽取
});

const r = await comp.compact(events);
// r.compacted     是否真的压了
// r.events        新上下文：摘要块 + 最近 N 轮
// r.anchors       被折叠事件的 id 列表（摘要里也写了一份）
// r.shadowed      被折叠的原文，存哪儿由你决定
// r.beforeTokens / r.afterTokens

// 想核对摘要对不对：
for (const e of comp.expand(r)) console.log(e.id, e.text);

// 审计每次压缩：
console.log(comp.stats());
// [{ at, beforeK, afterK, freedK, folded, keptTurns }]
```

三层策略（跟她实际在用的那套一致）：

| 层 | 做什么 | 什么时候 |
|---|---|---|
| prune | 工具输出掐头去尾 | 单条超过 `thresholdChars` |
| compact | 旧轮次折叠成摘要 | 总占用超过 `windowTokens × thresholdRatio` |
| stats | 记录放掉多少、留几轮 | 每次压缩后 |

**保证不变大的保护**：如果摘要比原文还长（窗口很小时会这样），会先截短；实在压不下去就跳过并返回 `note`，不会假装压过。

## 命令行

```bash
# 体检
npx memory-graph health --dir ./data --scope user:alice

# 召回
npx memory-graph recall --dir ./data --scope user:alice --query 下雨

# 跨 scope
npx memory-graph recall-all --dir ./data --scopes user:alice,agent:chiyo --query 下雨

# 夜间整理（dry-run / --apply）
npx memory-graph nightly --dir ./data --scopes user:alice --apply

# 共享记忆
npx memory-graph shared-list --dir ./data
npx memory-graph shared-approve --dir ./data --id s_xxx --by owner
```

配合系统计划任务，每天凌晨自动整理：

```bash
# Linux / macOS
0 3 * * * cd /path/to/app && npx memory-graph nightly --dir ./data --scopes user:alice --apply
```

## 存储

JSONL，按 scope 和月份分文件：

```
memory-data/
├─ user_alice/2026-11.jsonl
├─ agent_chiyo/2026-11.jsonl
└─ shared_global/2026-11.jsonl   ← 共享记忆独立存放
```

- **last-wins**：同 id 以最后一条为准，改状态不改历史
- **可 grep**：你的记忆是你自己的
- **崩溃安全**：最多丢最后一行

## 核心概念

| 概念 | 说明 |
|---|---|
| `scope` | `user:alice` / `agent:chiyo` / `group:demo`，隔离单位 |
| `kind` | `fact`（有锚点）/ `impression`（主观）/ `plan`（有失效期） |
| `layer` | `instant` / `short` / `long` / `cold` / `permanent` |
| `anchors` | 原话片段，用于回溯与验证 |
| `relations` | 节点间的边，召回可扩散 |
| `status` | plan 专用：`active` / `done` / `abandoned` / `expired` |

## 规则抽取 / 人物 / 时间线 / 体检 / 星图

```js
// 规则：从原话里认出规矩与承诺
const rules = mem.extractRules('以后不要在深夜给我发消息', { speaker: 'owner' });
// → [{ kind:'fact', text:'以后不要在深夜给我发消息', cluster:'rule-owner', anchors:[...] }]
mem.write('user:alice', { nodes: rules });

// 人物：登记 → 别名解析 → 合并审批
mem.person.upsert({ name: '阿岚', aliases: ['小岚'] });
const p = mem.person.proposeMerge('阿岚', '岚岚');
mem.person.approveMerge(p.id, { by: 'owner' });

// 时间线：这段时间发生了什么 + 哪些话没进记忆
mem.episode({ scope: 'user:alice', from: Date.now() - 86400_000 });
mem.missedScan({ scope: 'user:alice', messages });

// 体检：六项指标
mem.healthReport({ scope: 'user:alice' });
// { checks: [锚点覆盖率, 重复率, 长期占比, 即时占比, 陈旧度, 归档与共享], ok, failed }

// 星图：SVG 或 Mermaid
const svg = mem.starMap(mem.load('user:alice'), { title: '她的记忆星图' });
const mmd = mem.mermaid(mem.load('user:alice'));
```

### 人格旋钮（可选，跟记忆无关）

> ⚠️ 这一层是**角色扮演**，不是记忆。记忆回答"发生过什么"，人格回答"用什么性格说话"。
> 不需要的话完全不调用即可，不影响其它能力。

```js
mem.persona.get();                    // { tsundere, playfulness, initiative, softness, snark, moodSwing }
mem.persona.tune('initiative', 0.05, { by: 'owner', reason: '希望更主动' });
mem.persona.summary();                // 「傲娇 中等；爱玩 偏高；主动 很高…」
mem.persona.revert();
```

三重刹车（防止人格一夜之间漂走）：

```
单步 ≤ 0.05      · 每天最多 1 次      · 距基线累计偏移 ≤ 0.15
```

## 范围说明

- **长期记忆**：跨会话的节点、衰减、关系、整理（本项目的核心）
- **上下文压缩**：单次对话太长时腾出窗口，摘要带锚点可回溯（v0.3.0 起内置）

两者互补：压缩管"这一次对话装不下"，整理管"跨天该忘什么"。

## 测试

```bash
npm test
# 47 tests: 锚点 / 召回 / 去重 / 即时记忆 / 整理 / 层推进 / 体检
         跨 scope / 共享审批 / plan 过期 / 关系边扩展 / nightly 全流程
         压缩 / 规则抽取 / 敏感过滤 / 锚点强校验 / 幂等键 / 人物合并 / 时间线 / 漏检
         自动抽取 / 提示词装配 / 快照往返 / 关系衰减 / 共享审计配额 / store 缓存
         矛盾检测 / 矛盾扫描 / 写锁超时 / 陈旧锁 / 损坏修复 / d.ts 完整 / 召回性能护栏
```

## 设计取舍

- **不做嵌入向量**：默认字符 bigram + 关键词 + 重要度，零依赖、可解释；
  要语义检索可自行替换 `recall`（纯函数，好接 embedding）。
- **不自动摘要**：摘要会丢掉原话，而原话是这套系统的地基。
- **不删除**：归档只是 `archived: true`，永远可恢复。
- **共享要审批**：默认只能提名，批准后才跨会话可见。

## License

MIT © 浮水梦华
