/**
 * index.js —— 对外入口
 *
 * 用法：
 *   import { createMemory } from 'dsh-memory-graph-chiyo';
 *   const mem = createMemory({ dir: './data' });
 *   mem.write('user:alice', { nodes: [{ kind: 'fact', text: '她喜欢下雨天', anchors: [{ quote: '我最喜欢下雨了' }] }] });
 *   mem.recall('user:alice', { query: '下雨' });
 */
import { JsonlStore } from './store.js';
import { MemoryGraph } from './core.js';
import { InstantMemory } from './instant.js';
import { consolidate, health } from './consolidate.js';

export { JsonlStore } from './store.js';
export { MemoryGraph, LAYERS, KINDS, CATEGORIES, similarity, normalizeText, importanceOf } from './core.js';
export { InstantMemory } from './instant.js';
export { consolidate, health } from './consolidate.js';

export function createMemory({ dir, options = {}, clock } = {}) {
  const store = new JsonlStore({ dir: dir || './memory-data' });
  const graph = new MemoryGraph({ store, options, clock });
  const instant = new InstantMemory({ graph, clock });
  const memory = {
    store,
    graph,
    instant,
    write: (scope, payload) => graph.write(scope, payload),
    recall: (scope, opts) => graph.recall(scope, opts),
    load: (scope) => graph.load(scope),
    tickLayers: (scope, opts) => graph.tick(scope, opts),
    consolidate: (scope, opts) => consolidate(graph, scope, opts),
    health: (scope, opts) => health(graph, scope, opts),
    writeInstant: (scope, payload) => instant.write(scope, payload),
    tickInstant: (scope, opts) => instant.tick(scope, opts),
    reviveInstant: (scope, payload) => instant.revive(scope, payload),
  };
  return memory;
}

export default createMemory;
