/**
 * index.js —— 对外入口（v0.2.0）
 *
 * 用法：
 *   import { createMemory } from 'dsh-memory-graph-chiyo';
 *   const mem = createMemory({ dir: './data' });
 *   mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
 *   mem.recallAcross(['user:alice', 'agent:chiyo'], { query: '下雨' });
 *   mem.nightly(['user:alice'], { apply: true });
 */
import { JsonlStore } from './store.js';
import { MemoryGraph } from './core.js';
import { InstantMemory } from './instant.js';
import { SharedMemory } from './shared.js';
import { consolidate, health } from './consolidate.js';
import { tickAll, nightly } from './lifecycle.js';
import { Compactor, createCompactor, estimateTokens, pruneToolResults } from './compact.js';
import { PersonLayer } from './person.js';
import { Persona } from './persona.js';
import { extractRules } from './rules.js';
import { buildEpisode, missedScan } from './timeline.js';
import { healthReport } from './health.js';
import { renderStarMap, renderMermaid } from './viz.js';
import { scanSensitive } from './sensitive.js';
import { heuristicExtract, extractAndWrite, buildExtractionPrompt } from './extractor.js';
import { assembleContext } from './assemble.js';
import { exportBundle, importBundle, saveBundle, loadBundle } from './snapshot.js';
import { scanConflicts, findConflict, polarityOf } from './conflicts.js';
import { scanStore, repairStore } from './repair.js';

export { JsonlStore } from './store.js';
export { MemoryGraph, LAYERS, KINDS, CATEGORIES, REL_TYPES, PLAN_STATUSES, similarity, normalizeText, importanceOf } from './core.js';
export { InstantMemory } from './instant.js';
export { SharedMemory, SHARED_SCOPE } from './shared.js';
export { consolidate, health } from './consolidate.js';
export { tickAll, nightly } from './lifecycle.js';
export { Compactor, createCompactor, estimateTokens, pruneToolResults, extractiveSummary } from './compact.js';
export { PersonLayer, PERSON_SCOPE } from './person.js';
export { Persona, DEFAULT_KNOBS, KNOB_LABELS, PERSONA_LIMITS, PERSONA_SCOPE } from './persona.js';
export { extractRules, classifyRule } from './rules.js';
export { buildEpisode, missedScan } from './timeline.js';
export { healthReport } from './health.js';
export { renderStarMap, renderMermaid } from './viz.js';
export { scanSensitive, assertNotSensitive } from './sensitive.js';
export { findMissingAnchors, quoteExists, extractAnchors } from './anchor.js';
export { heuristicExtract, extractAndWrite, buildExtractionPrompt } from './extractor.js';
export { assembleContext } from './assemble.js';
export { exportBundle, importBundle, saveBundle, loadBundle } from './snapshot.js';
export { scanConflicts, findConflict, polarityOf } from './conflicts.js';
export { scanStore, repairStore } from './repair.js';

export function createMemory({ dir, options = {}, clock } = {}) {
  const store = new JsonlStore({ dir: dir || './memory-data' });
  const graph = new MemoryGraph({ store, options, clock });
  const instant = new InstantMemory({ graph, clock });
  const shared = new SharedMemory({ store, clock });
  const personLayer = new PersonLayer({ store, clock });
  const persona = new Persona({ store, clock });

  const memory = {
    store,
    graph,
    instant,
    shared,
    person: personLayer,
    persona,

    // 长期记忆
    write: (scope, payload) => graph.write(scope, payload),
    recall: (scope, opts) => graph.recall(scope, opts),
    recallAcross: (scopes, opts) => graph.recallAcross(scopes, opts),
    load: (scope) => graph.load(scope),

    // 层与计划
    tickLayers: (scope, opts) => graph.tick(scope, opts),
    tickPlans: (scope, opts) => graph.tickPlans(scope, opts),
    setPlanStatus: (scope, id, status, reason) => graph.setPlanStatus(scope, id, status, reason),

    // 即时记忆
    writeInstant: (scope, payload) => instant.write(scope, payload),
    tickInstant: (scope, opts) => instant.tick(scope, opts),
    reviveInstant: (scope, payload) => instant.revive(scope, payload),

    // 共享记忆
    proposeShared: (payload) => shared.propose(payload),
    approveShared: (id, opts) => shared.approve(id, opts),
    revokeShared: (id, opts) => shared.revoke(id, opts),
    listShared: (opts) => shared.list(opts),
    recallShared: (opts) => shared.recall(opts),

    // 规则 / 人物 / 时间线 / 体检 / 星图
    extractRules: (text, opts) => extractRules(text, opts),
    episode: (opts) => buildEpisode(memory, opts),
    missedScan: (opts) => missedScan(memory, opts),
    healthReport: (opts) => healthReport(memory, opts.scope, opts),
    starMap: (list, opts) => renderStarMap(list ?? memory.load(opts?.scope ?? 'user:demo'), opts),
    mermaid: (list, opts) => renderMermaid(list ?? memory.load(opts?.scope ?? 'user:demo'), opts),
    scanSensitive: (text, opts) => scanSensitive(text, opts),

    // 抽取 / 装配 / 快照 / 关系衰减
    heuristicExtract: (messages, opts) => heuristicExtract(messages, opts),
    extractAndWrite: (scope, messages, opts) => extractAndWrite(memory, scope, messages, opts),
    buildExtractionPrompt: (messages) => buildExtractionPrompt(messages),
    assembleContext: (opts) => assembleContext(memory, opts),
    exportBundle: (opts) => exportBundle(opts?.dir ?? dir, opts),
    importBundle: (bundle, opts) => importBundle(bundle, opts?.dir ?? dir, opts),
    decayRelations: (scope, opts) => graph.decayRelations(scope, opts),
    scanConflicts: (scope, opts) => scanConflicts(graph, scope, opts),
    scanStore: (opts) => scanStore(opts?.dir ?? dir),
    repairStore: (opts) => repairStore(opts?.dir ?? dir, opts),

    // 整理与体检
    consolidate: (scope, opts) => consolidate(graph, scope, opts),
    health: (scope, opts) => health(graph, scope, opts),
    tickAll: (opts) => tickAll(memory, opts),
    nightly: (scopes, opts) => nightly(memory, { scopes, ...(opts || {}) }),
  };
  memory.compactor = (opts) => createCompactor(opts);
  return memory;
}

export default createMemory;
