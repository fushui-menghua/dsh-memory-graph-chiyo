// Type definitions for dsh-memory-graph-chiyo 0.6
// 手写声明，追求"能用、不骗人"：不确定的结构用宽松类型。

export type Scope = string;
export type Kind = 'fact' | 'impression' | 'plan';
export type Category = 'preference' | 'experience' | 'relationship' | 'plan' | 'emotion' | 'topic';
export type Layer = 'instant' | 'short' | 'long' | 'cold' | 'permanent';
export type RelationType = 'person' | 'relationship' | 'because' | 'derivedFrom' | 'supports' | 'contradicts';
export type PlanStatus = 'active' | 'done' | 'abandoned' | 'expired';

export interface Anchor {
  quote: string;
  source?: string;
  at?: number;
}

export interface Relation {
  type: RelationType;
  targetId: string;
  weight?: number;
}

export interface MemoryNode {
  id: string;
  scope: Scope;
  kind: Kind | 'instant';
  text: string;
  anchors: Anchor[];
  relations?: Relation[];
  category?: Category | string;
  layer?: Layer;
  cluster?: string;
  status?: PlanStatus;
  validTo?: number;
  mentionCount?: number;
  recallCount?: number;
  importance?: number;
  idempotencyKey?: string;
  mentionKey?: string;
  superseded?: boolean;
  supersededBy?: string;
  supersedes?: string;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
  lastTouchedAt?: number;
  [key: string]: unknown;
}

export interface WriteInput {
  kind: Kind;
  text: string;
  anchors?: Anchor[];
  relations?: Relation[];
  category?: Category | string;
  cluster?: string;
  idempotencyKey?: string;
  mentionKey?: string;
  validDays?: number;
  validTo?: number;
}

export interface WriteOptions {
  nodes: WriteInput[];
  writer?: string;
  messages?: Array<string | { text?: string; content?: string }> | null;
  allowSensitive?: boolean;
  sensitiveAllow?: string[];
}

export interface WriteResult {
  written: MemoryNode[];
  merged: Array<{ id: string; text: string; mentionCount: number }>;
  total: number;
}

export interface RecallOptions {
  query?: string;
  limit?: number;
  includeCold?: boolean;
  includeArchived?: boolean;
  includeSuperseded?: boolean;
  hops?: number;
}

export interface RecalledNode extends MemoryNode {
  score: number;
  via?: string;
  relation?: RelationType;
}

export interface AssembleOptions {
  scopes: Scope[];
  query?: string;
  tokenBudget?: number;
  includeShared?: boolean;
  includePlans?: boolean;
  limit?: number;
}

export interface AssembleResult {
  text: string;
  tokens: number;
  used: string[];
  total: number;
}

export interface CompactOptions {
  windowTokens?: number;
  thresholdRatio?: number;
  keepTurns?: number;
  pruner?: { thresholdChars?: number; headChars?: number; tailChars?: number };
  summaryMaxChars?: number;
  summarizer?: (events: unknown[], ctx: { estimateTokens: (s: string) => number; maxChars: number }) => string | Promise<string>;
}

export interface CompactResult {
  compacted: boolean;
  events: unknown[];
  beforeTokens: number;
  afterTokens: number;
  shadowed?: unknown[];
  anchors?: string[];
  summary?: string;
  pruned?: number;
  savedChars?: number;
  note?: string;
}

export interface SharedEntry {
  id: string;
  text: string;
  judgment?: string;
  sourceScope: string;
  status: 'proposed' | 'approved' | 'revoked';
  dependsOn?: string[];
  proposedAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  value: number;
  detail: string;
}

export interface HealthReport {
  scope: Scope;
  at: string;
  total: number;
  live: number;
  archived: number;
  byLayer: Record<string, number>;
  byKind: Record<string, number>;
  checks: HealthCheck[];
  ok: boolean;
  failed: string[];
}

export interface Memory {
  store: unknown;
  graph: unknown;
  instant: unknown;
  shared: unknown;
  person: unknown;
  persona: unknown;

  write(scope: Scope, input: WriteOptions): WriteResult;
  recall(scope: Scope, opts?: RecallOptions): RecalledNode[];
  recallAcross(scopes: Scope[], opts?: RecallOptions & { perScopeLimit?: number }): RecalledNode[];
  load(scope: Scope): MemoryNode[];

  tickLayers(scope: Scope, opts?: { now?: number; apply?: boolean }): Array<{ id: string; from: string; to: string }>;
  tickPlans(scope: Scope, opts?: { now?: number; apply?: boolean }): Array<{ id: string; text: string }>;
  setPlanStatus(scope: Scope, id: string, status: PlanStatus, reason?: string): MemoryNode;

  writeInstant(scope: Scope, input: { text: string; topicKey: string; eventKey: string; personKey?: string }): MemoryNode;
  tickInstant(scope: Scope, opts?: { now?: number; apply?: boolean }): Array<{ id: string; from: string; to: string }>;
  reviveInstant(scope: Scope, input: { topicKey: string; eventKey: string; personKey?: string }): unknown;

  proposeShared(input: { text: string; sourceScope: string; judgment?: string; by?: string; dependsOn?: string[] }): SharedEntry;
  approveShared(id: string, opts?: { by?: string }): SharedEntry;
  revokeShared(id: string, opts?: { by?: string; reason?: string; cascade?: boolean }): SharedEntry;
  listShared(opts?: { status?: string }): SharedEntry[];
  recallShared(opts?: { query?: string; limit?: number }): Array<SharedEntry & { score: number }>;

  heuristicExtract(messages: unknown[], opts?: { speaker?: 'owner' | 'self'; max?: number }): WriteInput[];
  extractAndWrite(scope: Scope, messages: unknown[], opts?: { speaker?: 'owner' | 'self'; max?: number }): { written: MemoryNode[]; merged: unknown[]; skipped: unknown[] };
  buildExtractionPrompt(messages: unknown[]): string;
  assembleContext(opts: AssembleOptions): AssembleResult;

  exportBundle(opts?: { dir?: string; note?: string }): unknown;
  importBundle(bundle: unknown, opts?: { dir?: string; overwrite?: boolean }): { written: number; skipped: number; dir: string };
  decayRelations(scope: Scope, opts?: { now?: number; halfLifeDays?: number; minWeight?: number; apply?: boolean }): unknown;

  scanConflicts(scope: Scope, opts?: { apply?: boolean; minSubjectSim?: number }): Array<{ oldId: string; newId: string; oldText: string; newText: string }>;
  scanStore(opts?: { dir?: string }): unknown;
  repairStore(opts?: { dir?: string; apply?: boolean }): unknown;

  extractRules(text: string, opts?: { speaker?: 'owner' | 'self' }): WriteInput[];
  episode(opts: { scope: Scope; from?: number; to?: number }): unknown;
  missedScan(opts: { scope: Scope; messages: unknown[] }): unknown;
  healthReport(opts: { scope: Scope; now?: number }): HealthReport;
  starMap(nodes?: MemoryNode[], opts?: { width?: number; height?: number; title?: string; showLabels?: boolean }): string;
  mermaid(nodes?: MemoryNode[], opts?: { maxNodes?: number }): string;
  scanSensitive(text: string, opts?: { allow?: string[] }): Array<{ type: string; label: string }>;

  consolidate(scope: Scope, opts?: { apply?: boolean }): unknown;
  health(scope: Scope, opts?: { now?: number }): unknown;
  tickAll(opts: { scope?: Scope; now?: number; apply?: boolean }): unknown;
  nightly(scopes: Scope[], opts?: { now?: number; apply?: boolean }): unknown;

  compactor(opts?: CompactOptions): { compact(events: unknown[]): Promise<CompactResult>; expand(record: CompactResult | unknown): unknown[]; stats(): unknown[] };
}

export function createMemory(config?: { dir?: string; options?: Record<string, unknown>; clock?: () => number }): Memory;
export default createMemory;

export function estimateTokens(text: string): number;
export function pruneToolResults(events: unknown[], options?: Record<string, unknown>): { events: unknown[]; pruned: number; savedChars: number };
export function createCompactor(options?: CompactOptions): Memory['compactor'] extends (o?: CompactOptions) => infer R ? R : never;

export function scanSensitive(text: string, opts?: { allow?: string[] }): Array<{ type: string; label: string }>;
export function assertNotSensitive(text: string, opts?: { allow?: string[] }): true;
export function findMissingAnchors(anchors: Array<{ quote: string }>, messages: unknown[]): string[];
export function quoteExists(quote: string, messages: unknown[]): boolean;
export function extractAnchors(text: string, messages: unknown[], opts?: { max?: number; minLen?: number }): Anchor[];

export function heuristicExtract(messages: unknown[], opts?: { speaker?: 'owner' | 'self'; max?: number }): WriteInput[];
export function extractAndWrite(memory: Memory, scope: Scope, messages: unknown[], opts?: Record<string, unknown>): unknown;
export function buildExtractionPrompt(messages: unknown[]): string;
export function assembleContext(memory: Memory, opts: AssembleOptions): AssembleResult;

export function exportBundle(dir: string, opts?: { note?: string }): unknown;
export function importBundle(bundle: unknown, dir: string, opts?: { overwrite?: boolean }): unknown;
export function saveBundle(bundle: unknown, file: string): string;
export function loadBundle(file: string): unknown;

export function scanConflicts(graph: unknown, scope: Scope, opts?: Record<string, unknown>): unknown;
export function findConflict(existing: MemoryNode[], candidate: { text: string; kind: string; category?: string }, opts?: { minSubjectSim?: number }): unknown;
export function polarityOf(text: string): 'pos' | 'neg' | 'neutral';
export function scanStore(dir: string): unknown;
export function repairStore(dir: string, opts?: { apply?: boolean }): unknown;

export function renderStarMap(nodes: MemoryNode[], opts?: Record<string, unknown>): string;
export function renderMermaid(nodes: MemoryNode[], opts?: Record<string, unknown>): string;
export function healthReport(memory: Memory, scope: Scope, opts?: Record<string, unknown>): HealthReport;

export function extractRules(text: string, opts?: { speaker?: 'owner' | 'self'; at?: number; max?: number }): WriteInput[];
export function classifyRule(text: string, opts?: { speaker?: 'owner' | 'self' }): string | null;

export function consolidate(graph: unknown, scope: Scope, opts?: { apply?: boolean; now?: number }): unknown;
export function health(graph: unknown, scope: Scope, opts?: { now?: number }): unknown;
export function tickAll(memory: Memory, opts?: { scope?: Scope; now?: number; apply?: boolean }): unknown;
export function nightly(memory: Memory, opts?: { scopes?: Scope[]; now?: number; apply?: boolean }): unknown;

export function buildEpisode(memory: Memory, opts: { scope: Scope; from?: number; to?: number }): unknown;
export function missedScan(memory: Memory, opts: { scope: Scope; messages: unknown[] }): unknown;

export const LAYERS: Layer[];
export const KINDS: Kind[];
export const CATEGORIES: Category[];
export const REL_TYPES: RelationType[];
export const PLAN_STATUSES: PlanStatus[];
export const DEFAULT_KNOBS: Record<string, number>;
export const KNOB_LABELS: Record<string, string>;
export const PERSONA_LIMITS: { maxStep: number; maxPerDay: number; maxDrift: number };

export function similarity(query: string, text: string): number;
export function normalizeText(text: string): string;
export function importanceOf(node: Partial<MemoryNode>, now?: number): number;
export function scopeKey(scope: string): string;

export class JsonlStore {
  constructor(options: { dir: string });
  dir: string;
  append(scope: Scope, record: object): object;
  load(scope: Scope): object[];
  listScopes(): Scope[];
}

export class MemoryGraph {
  constructor(options: { store: JsonlStore; options?: Record<string, unknown>; clock?: () => number });
  write(scope: Scope, input: WriteOptions): WriteResult;
  recall(scope: Scope, opts?: RecallOptions): RecalledNode[];
  recallAcross(scopes: Scope[], opts?: RecallOptions & { perScopeLimit?: number }): RecalledNode[];
  load(scope: Scope): MemoryNode[];
  tick(scope: Scope, opts?: Record<string, unknown>): unknown;
  tickPlans(scope: Scope, opts?: Record<string, unknown>): unknown;
  setPlanStatus(scope: Scope, id: string, status: PlanStatus, reason?: string): MemoryNode;
  decayRelations(scope: Scope, opts?: Record<string, unknown>): unknown;
}

export class InstantMemory {
  constructor(options: { graph: MemoryGraph; options?: Record<string, unknown>; clock?: () => number });
  write(scope: Scope, input: Record<string, unknown>): MemoryNode;
  tick(scope: Scope, opts?: Record<string, unknown>): unknown;
  revive(scope: Scope, input: Record<string, unknown>): unknown;
}

export class SharedMemory {
  constructor(options: { store: JsonlStore; clock?: () => number; dailyQuota?: number });
  propose(input: Record<string, unknown>): SharedEntry;
  approve(id: string, opts?: { by?: string }): SharedEntry;
  revoke(id: string, opts?: { by?: string; reason?: string; cascade?: boolean }): SharedEntry;
  list(opts?: { status?: string }): SharedEntry[];
  recall(opts?: { query?: string; limit?: number }): Array<SharedEntry & { score: number }>;
  audit(opts?: { limit?: number }): unknown[];
}

export class PersonLayer {
  constructor(options: { store: JsonlStore; clock?: () => number });
  upsert(input: { name: string; aliases?: string[]; note?: string; confirmed?: boolean }): unknown;
  resolve(name: string): unknown;
  proposeMerge(a: string, b: string, opts?: { reason?: string }): unknown;
  approveMerge(id: string, opts?: { by?: string }): unknown;
  list(opts?: { includeProposals?: boolean }): unknown;
}

export class Persona {
  constructor(options: { store: JsonlStore; clock?: () => number; limits?: Record<string, number> });
  get(): Record<string, number>;
  tune(key: string, delta: number, opts?: { by?: string; reason?: string }): Record<string, number>;
  revert(): Record<string, number>;
  summary(): string;
  state(): unknown;
}

export class Compactor {
  constructor(options?: CompactOptions);
  compact(events: unknown[]): Promise<CompactResult>;
  expand(record: CompactResult | unknown): unknown[];
  stats(): unknown[];
  count(events: unknown[]): number;
}
