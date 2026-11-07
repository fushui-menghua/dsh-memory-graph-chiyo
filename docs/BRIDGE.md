# 桥接场景接入（QQ / 微信 / 任何自己拉提示词的机器人）

> 目标：让**桥接里的人格机器人**像小肥鱼那样，自动记住该记的、自动想起该想起的。

插件本身只提供引擎和 5 个工具；桥接不会自动"每轮查、每轮写"。所以这里给一层适配：

```js
import { createBridgeMemory } from 'dsh-memory-graph-chiyo/bridge';

const bm = createBridgeMemory({
  dir: 'D:/data/chiyo-memory',   // 记忆放哪
  scope: 'agent:chiyo',          // 这个机器人的分区
  tokenBudget: 1200,             // 每轮最多注入多少 token
});
```

## 三步接入

### ① 每轮开始前：把记忆拼进提示词

```js
// 桥接里组装 prompt 的地方
const memoryBlock = bm.beforeTurn({ query: 用户这句话 });
const prompt = `${memoryBlock}\n\n${原本的提示词}`;
```

返回的样子：

```
【记得的事】
- [long] 她讨厌下雨天 (n_1a2b3c4d)
- 她养了一只猫叫豆豆 (n_5e6f7a8b)

【在办的事】
- 周末去看海（到 2026-11-10） (n_9c0d1e2f)

【共享记忆】
- 雨天适合听老唱片
```

没有命中就返回空串，`prompt` 里自然不会多出东西。

### ② 每轮结束后：自动抽取

```js
// 拿到用户发言和机器人回复之后
bm.afterTurn({
  messages: [
    { text: 用户的这句话 },
    { text: 机器人的回复 },
  ],
  speaker: 'owner',   // 'owner' 抽"主人说的"，'self' 抽"她自己承诺的"
});
```

抽到的是**带锚点的候选**：规矩/承诺优先，其次是喜欢/讨厌/怕/想/住/工作这类事实；敏感内容（路径、QQ号、凭据）自动跳过；同义重复自动合并。

### ③ 每天整理（二选一）

```js
// A：进程内定时
setInterval(() => bm.nightly({ apply: true }), 24 * 3600 * 1000);

// B：交给系统计划任务（推荐，进程重启也不影响）
//    memory-graph nightly --dir D:/data/chiyo-memory --scopes agent:chiyo --apply
```

## 为什么不做成"全自动"

DSH 没有暴露"每轮开始/结束"的事件钩子（宿主里没有 turn 事件），插件没法自己挂上去。
硬做只能在框架里改源码——那就把别人绑死了。

这层适配的好处是：**桥接里两行，其他框架也能用**（AstrBot 的 hook、自己写的循环都行）。

## 和"小肥鱼现在那套"的区别

| 能力 | 小肥鱼桥接内建 | 本插件 + 适配层 |
|---|---|---|
| 自动抽取 | ✅ | ✅ `afterTurn` |
| 自动注入 | ✅ | ✅ `beforeTurn` |
| 夜间整理 | ✅ | ✅ `nightly` |
| 做梦 / 自主待办 / 唤醒调度 | ✅ | ❌ 不属于记忆层 |
| 锚点 / 衰减 / 冲突检测 / 共享审批 | ✅ | ✅ |
| 跨框架可用 | ❌ 绑死桥接 | ✅ |

也就是说：**记忆这条线能对齐，行为调度那条线不在这个包里。**
