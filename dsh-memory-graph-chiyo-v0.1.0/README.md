# dsh-memory-graph-chiyo

> 可回溯、会遗忘、会睡觉整理的记忆内核。给 AI agent 用的长期记忆图。

[![tests](https://img.shields.io/badge/tests-7%20passing-brightgreen)](https://github.com/fushui-menghua/dsh-memory-graph-chiyo)
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

**本项目走的是 B+C 的混合，但多三件事：**

1. **锚点强制（anchors）** —— fact / plan 必须能指回原话片段，否则拒收。
   记忆不是"模型的总结"，而是"能回到哪一句"。
2. **四层衰减** —— instant → short → long → cold → permanent；
   不是只增不减的仓库，长期没动静会降冷。
3. **夜间整理（consolidation）** —— 归档重复与墓碑，把提过多次、规则承诺类升层。

一句话：**它记得住，也忘得掉，而且每晚自己整理。**

## 安装

```bash
npm i dsh-memory-graph-chiyo
```

要求 Node ≥ 20，零依赖。

## 快速开始

```js
import { createMemory } from 'dsh-memory-graph-chiyo';

const mem = createMemory({ dir: './memory-data' });

// 写：fact 必须带锚点（原话）
mem.write('user:alice', {
  nodes: [
    { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
    { kind: 'fact', text: '她养了一只猫叫豆豆', category: 'relationship', anchors: [{ quote: '豆豆今天又拆家了' }] },
  ],
});

// 召回：语义相似 + 关键词 + 重要度 + 新鲜度
const hits = mem.recall('user:alice', { query: '下雨' });
// → [{ id, text: '她喜欢下雨天', anchors: [...], score: 1.42, ... }]

// 即时记忆：醒 6h → 睡 6h → 墓碑；复活 3 次自动升级成 fact
mem.writeInstant('user:alice', { text: '今天聊到了潮汐', topicKey: 'tide', eventKey: 'chat-1' });
mem.reviveInstant('user:alice', { topicKey: 'tide', eventKey: 'chat-1' });

// 层推进 + 夜间整理
mem.tickLayers('user:alice');
const report = mem.consolidate('user:alice', { apply: true });

// 体检
console.log(mem.health('user:alice'));
```

## 存储

JSONL，按 scope 和月份分文件：

```
memory-data/
└─ user_alice/
   ├─ 2026-11.jsonl
   └─ 2026-12.jsonl
```

- **last-wins**：同 id 以最后一条为准，天然支持"改状态"而不改历史
- **可 grep**：你的记忆是你自己的，能被文本工具审
- **崩溃安全**：最多丢最后一行，不会出现半事务

## 核心概念

| 概念 | 说明 |
|---|---|
| `scope` | `user:alice` / `agent:chiyo` / `project:demo`，记忆的隔离单位 |
| `kind` | `fact`（有锚点）/ `impression`（主观，可无锚点）/ `plan`（有失效期） |
| `layer` | `instant` / `short` / `long` / `cold` / `permanent` |
| `anchors` | 原话片段，用于回溯与验证 |
| `importance` | 提及次数、召回次数、锚点数、类别、新鲜度的加权 |

## 跨会话召回与共享记忆（roadmap）

- [x] 单 scope 召回
- [x] 即时记忆生命周期
- [x] 夜间整理 + 体检
- [ ] 跨 scope 召回（多 scope 合并打分）
- [ ] 共享层：propose → approve → 跨会话可见，带撤销

## 测试

```bash
npm test
# 7 tests: 锚点校验 / 召回 / 去重 / 即时记忆 / 整理 / 层推进 / 体检
```

## 设计取舍

- **不做嵌入向量**：默认实现是字符 bigram + 关键词 + 重要度，零依赖、可解释；
  想要语义检索可以自己接 embedding，`recall` 是纯函数，好替换。
- **不自动摘要**：摘要会丢掉"原话"，而原话是这套系统的地基。
  需要摘要的场景请在外层做，并保留锚点。
- **不删除**：归档只是 `archived: true`，永远可恢复。

## License

MIT
