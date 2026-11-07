# API 速查

所有入口都从包根导入：

```js
import { createMemory, write, ... } from 'dsh-memory-graph-chiyo';
const mem = createMemory({ dir: './memory-data', options: {} });
```

## 记忆图

### `mem.write(scope, { nodes, messages?, allowSensitive?, sensitiveAllow? })`
写节点。`fact`/`plan` 必须有锚点；传了 `messages` 时锚点必须能在原文里找到。
- `nodes[].kind`: `fact` | `impression` | `plan`
- `nodes[].anchors`: `[{ quote, source?, at? }]`
- `nodes[].relations`: `[{ type, targetId, weight? }]`，类型见 `REL_TYPES`
- `nodes[].idempotencyKey` / `mentionKey`：幂等去重
- `nodes[].validDays` / `validTo`：plan 专用
返回 `{ written, merged, total }`。

### `mem.recall(scope, { query, limit, includeCold, includeArchived, hops })`
召回。`hops=1` 沿关系边扩展（出边 + 入边）。命中会提升 `recallCount` 与重要度。

### `mem.recallAcross(scopes, { query, limit, perScopeLimit, includeCold })`
多 scope 合并召回，结果带 `scope` 字段。

### `mem.load(scope)` / `mem.tickLayers(scope, { now, apply })`
读全部节点（last-wins）/ 推进层状态。

### `mem.tickPlans(scope)` / `mem.setPlanStatus(scope, id, status, reason)`
计划过期与手动改状态。

## 即时记忆

```js
mem.writeInstant(scope, { text, topicKey, eventKey, personKey? });
mem.tickInstant(scope, { now, apply });
mem.reviveInstant(scope, { topicKey, eventKey, personKey? });
```

## 共享记忆

```js
const e = mem.proposeShared({ text, sourceScope, judgment?, dependsOn? }); // 默认每天 3 条
mem.approveShared(e.id, { by });
mem.revokeShared(e.id, { by, reason, cascade: true });
mem.listShared({ status });
mem.recallShared({ query, limit });   // 只返回 approved
mem.shared.audit({ limit });
```

## 抽取 / 装配

```js
mem.heuristicExtract(messages, { speaker });
mem.extractAndWrite(scope, messages, { speaker, max });
mem.buildExtractionPrompt(messages);            // 给大模型用
mem.assembleContext({ scopes, query, tokenBudget });
// → { text, tokens, used, total }
```

## 压缩

```js
const comp = mem.compactor({ windowTokens: 128000, thresholdRatio: 0.3, keepTurns: 10 });
const r = await comp.compact(events);
comp.expand(r);   // 取回被折叠原文
comp.stats();     // 每次压缩放掉多少
```

## 整理 / 体检 / 计划任务

```js
mem.consolidate(scope, { apply });
mem.healthReport({ scope });     // 六项指标
mem.nightly(['user:alice'], { apply: true });
mem.tickAll({ scope, apply: true });
```

## 规则 / 人物 / 时间线 / 星图

```js
extractRules(text, { speaker });                 // 返回可写入的规则节点
mem.person.upsert({ name, aliases, note });
mem.person.proposeMerge(a, b); mem.person.approveMerge(id, { by });
mem.episode({ scope, from, to });
mem.missedScan({ scope, messages });
mem.starMap(nodes, { title });                   // SVG 字符串
mem.mermaid(nodes);                              // Mermaid 字符串
```

## 快照

```js
const bundle = mem.exportBundle({ note: 'before cleanup' });
saveBundle(bundle, './backup.json');
importBundle(loadBundle('./backup.json'), './memory-data', { overwrite: true });
```

## 关系衰减

```js
mem.decayRelations(scope, { halfLifeDays: 180, minWeight: 0.05, apply: true });
```

## 人格（可选，角色扮演层）

```js
mem.persona.get();
mem.persona.tune('initiative', 0.05, { by: 'owner', reason: '…' }); // ≤0.05/次，1 次/天，漂移 ≤0.15
mem.persona.summary();
mem.persona.revert();
```

## 命令行

```bash
npx memory-graph health   --dir ./data --scope user:alice
npx memory-graph recall   --dir ./data --scope user:alice --query 下雨
npx memory-graph recall-all --dir ./data --scopes user:alice,agent:chiyo --query 下雨
npx memory-graph nightly  --dir ./data --scopes user:alice --apply
npx memory-graph shared-list --dir ./data
npx memory-graph shared-approve --dir ./data --id s_xxx --by owner
```
