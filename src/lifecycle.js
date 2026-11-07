/**
 * lifecycle.js —— 睡一觉该做的事
 *
 * tickAll：把层状态机、即时记忆、计划过期全都推进一遍（可 dry-run）
 * nightly：整理 + 体检，产出报告（默认只算不改）
 *
 * 这就是"会睡觉整理"的入口。用系统计划任务每天凌晨调一次即可：
 *   0 3 * * *  node bin/cli.mjs nightly --apply
 */
import { consolidate, health } from './consolidate.js';

export function tickAll(memory, { scope, now = Date.now(), apply = true } = {}) {
  const layers = memory.graph.tick(scope, { now, apply });
  const instant = memory.instant.tick(scope, { now, apply });
  const plans = memory.graph.tickPlans(scope, { now, apply });
  return { scope, layers, instant, plans };
}

export function nightly(memory, { scopes = [], now = Date.now(), apply = false } = {}) {
  const report = { at: new Date(now).toISOString(), apply, scopes: [] };
  for (const scope of scopes) {
    const ticks = tickAll(memory, { scope, now, apply });
    const cons = consolidate(memory.graph, scope, { apply, now });
    const h = health(memory.graph, scope, { now });
    report.scopes.push({
      scope,
      layers: ticks.layers.length,
      instant: ticks.instant.length,
      plansExpired: ticks.plans.length,
      archived: cons.archived,
      reinforced: cons.reinforced,
      health: h,
    });
  }
  return report;
}
