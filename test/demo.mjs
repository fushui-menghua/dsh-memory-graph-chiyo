/**
 * demo.mjs —— 一分钟看完整流程
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiyo-demo-'));
const mem = createMemory({ dir });
const scope = 'user:alice';

console.log('数据目录：', dir, '\n');

mem.write(scope, {
  nodes: [
    { kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] },
    { kind: 'fact', text: '她养了一只猫叫豆豆', category: 'relationship', anchors: [{ quote: '豆豆今天又拆家了' }] },
    { kind: 'fact', text: '以后不要在深夜给她发消息', anchors: [{ quote: '深夜别找我' }] },
  ],
});
console.log('写入 3 条');

console.log('\n召回「下雨」：');
for (const h of mem.recall(scope, { query: '下雨' })) {
  console.log(`  [${h.kind}/${h.layer}] ${h.text}  (score ${h.score})`);
  if (h.anchors?.length) console.log(`    锚点：「${h.anchors[0].quote}」`);
}

const i = mem.writeInstant(scope, { text: '今天聊到了潮汐', topicKey: 'tide', eventKey: 'chat-1' });
console.log(`\n即时记忆：${i.text}（${i.instantStatus}）`);

const report = mem.consolidate(scope, { apply: true });
console.log(`\n夜间整理：归档 ${report.archived} 条，强化 ${report.reinforced} 条`);

console.log('\n体检：');
console.log(' ', JSON.stringify(mem.health(scope), null, 2).replace(/\n/g, '\n  '));
