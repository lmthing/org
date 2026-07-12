import { appendFileSync, readFileSync } from 'node:fs';
import type { NodeKind, TraceEvent } from '@lmthing/core';
import { computeTurnCost, type ModelPricing } from './pricing.js';

/** One delegation made inside a session — the target agent, the inputs it was
 *  given, and the tokens/cost attributed to that delegate's own turns (nearest
 *  enclosing delegate; a nested delegate keeps its own tokens). */
export interface DelegateEntry {
  /** `pkg/agent#action`, or `pkg/agent` when model-driven (no explicit action). */
  target: string;
  /** Truncated preview of the delegate's `query` input, when one was passed. */
  query?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model?: string;
  durationMs: number;
  status: 'running' | 'done' | 'error' | 'skipped';
  /** Delegation depth — 0 for a delegate made directly by the session's agent,
   *  >0 for a delegate spawned inside another delegate. */
  depth: number;
  ts: number;
}

/** One recorded session — a chat session, or a headless run spawned by a project
 *  hook / code node. Carries the session's own token totals plus the delegates it
 *  made (each with its own inputs + token breakdown). */
export interface SessionLedgerRecord {
  sessionId: string;
  /** Origin of the session: `chat`, `hook:<slug>`, or `code-node`. */
  source: string;
  projectId?: string;
  title?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error';
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  delegates: DelegateEntry[];
}

/** Identity of a session being tracked — supplied by the caller (SessionManager). */
export interface TrackBase {
  source: string;
  sessionId: string;
  projectId?: string;
}

interface Tracking {
  record: SessionLedgerRecord;
  /** node lineage, for walking an llm_response up to its enclosing delegate. */
  nodes: Map<string, { kind: NodeKind; parentId: string | null }>;
  /** delegate nodeId → its entry within record.delegates. */
  delegateByNode: Map<string, DelegateEntry>;
  lastFlush: number;
}

const MAX_RECORDS = 500;
/** Minimum ms between throttled (turn_end) flushes for a long-running session. */
const FLUSH_THROTTLE_MS = 2000;

/**
 * Pod-global ledger of every session (chat + hook/code-node headless) and the
 * delegates each made, with token/cost accounting at both levels. Fed from each
 * session's {@link Tracer} via {@link trackTracer}; persisted append-only to a
 * JSONL file (latest snapshot per sessionId wins on reload).
 */
export class SessionLedger {
  /** sessionId → most recent record (source of truth for reads). */
  private records = new Map<string, SessionLedgerRecord>();
  private tracking = new Map<string, Tracking>();

  constructor(
    private readonly filePath: string | null,
    private readonly prices: Record<string, ModelPricing>,
  ) {
    this.load();
  }

  /** Rebuild the in-memory map from the JSONL file, collapsing to the latest
   *  snapshot per sessionId and keeping the most recent MAX_RECORDS. */
  private load(): void {
    if (!this.filePath) return;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return; // no file yet — empty ledger
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as SessionLedgerRecord;
        if (rec && typeof rec.sessionId === 'string') this.records.set(rec.sessionId, rec);
      } catch {
        // skip a corrupt line — best-effort
      }
    }
    this.trim();
  }

  /** Drop the oldest records (by startedAt) beyond MAX_RECORDS. */
  private trim(): void {
    if (this.records.size <= MAX_RECORDS) return;
    const sorted = [...this.records.values()].sort((a, b) => a.startedAt - b.startedAt);
    for (const rec of sorted.slice(0, this.records.size - MAX_RECORDS)) {
      this.records.delete(rec.sessionId);
    }
  }

  /** Append one record snapshot to the JSONL file (best-effort). */
  private flush(sessionId: string): void {
    const rec = this.records.get(sessionId);
    if (!rec) return;
    const t = this.tracking.get(sessionId);
    if (t) t.lastFlush = Date.now();
    if (!this.filePath) return;
    try {
      appendFileSync(this.filePath, JSON.stringify(rec) + '\n', 'utf8');
    } catch {
      // best-effort persistence — never disturb the run
    }
  }

  /**
   * Subscribe to a session's tracer and maintain its ledger record. Safe to call
   * once per session (chat: at creation; headless: before start). Subscriber
   * errors are swallowed by the Tracer, so this never disturbs the turn loop.
   */
  trackTracer(tracer: { subscribe(fn: (e: TraceEvent) => void): () => void }, base: TrackBase): void {
    const record: SessionLedgerRecord = this.records.get(base.sessionId) ?? {
      sessionId: base.sessionId,
      source: base.source,
      ...(base.projectId !== undefined ? { projectId: base.projectId } : {}),
      startedAt: Date.now(),
      status: 'running',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      delegates: [],
    };
    // Adopt the live source/project (a reloaded stub may predate them).
    record.source = base.source;
    if (base.projectId !== undefined) record.projectId = base.projectId;
    this.records.set(base.sessionId, record);
    const t: Tracking = { record, nodes: new Map(), delegateByNode: new Map(), lastFlush: 0 };
    this.tracking.set(base.sessionId, t);
    this.trim();

    tracer.subscribe((e) => this.ingest(t, e));
  }

  private ingest(t: Tracking, e: TraceEvent): void {
    switch (e.type) {
      case 'node_start': {
        t.nodes.set(e.nodeId, { kind: e.kind, parentId: e.parentId });
        if (e.kind === 'delegate') {
          const d = e.detail ?? {};
          const target =
            `${d.pkg ?? '?'}/${d.agent ?? '?'}` + (d.action ? `#${d.action}` : '');
          const entry: DelegateEntry = {
            target,
            ...(typeof d.query === 'string' ? { query: d.query } : {}),
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            durationMs: 0,
            status: 'running',
            depth: typeof d.depth === 'number' ? d.depth : 0,
            ts: e.ts,
          };
          t.record.delegates.push(entry);
          t.delegateByNode.set(e.nodeId, entry);
        }
        break;
      }
      case 'llm_response': {
        if (typeof e.inputTokens !== 'number' || typeof e.outputTokens !== 'number') break;
        const cost = computeTurnCost(this.prices, e.model, e.inputTokens, e.outputTokens);
        t.record.totalInputTokens += e.inputTokens;
        t.record.totalOutputTokens += e.outputTokens;
        t.record.totalCostUsd += cost;
        // Attribute to the nearest enclosing delegate (self first, then ancestors).
        const entry = e.nodeId ? this.nearestDelegate(t, e.nodeId) : undefined;
        if (entry) {
          entry.inputTokens += e.inputTokens;
          entry.outputTokens += e.outputTokens;
          entry.costUsd += cost;
          if (e.model) entry.model = e.model;
        }
        break;
      }
      case 'node_end': {
        const entry = t.delegateByNode.get(e.nodeId);
        if (entry) {
          entry.durationMs = e.durationMs;
          entry.status = e.status;
          this.flush(t.record.sessionId); // persist as each delegate completes
        }
        break;
      }
      case 'session_meta': {
        if (e.title) t.record.title = e.title;
        break;
      }
      case 'turn_end': {
        // Throttled flush so a long chat session's totals stay fresh on disk
        // without an append per turn.
        if (Date.now() - t.lastFlush >= FLUSH_THROTTLE_MS) this.flush(t.record.sessionId);
        break;
      }
    }
  }

  /** Walk `nodeId` and its ancestors to the closest delegate node, if any. */
  private nearestDelegate(t: Tracking, nodeId: string): DelegateEntry | undefined {
    let cur: string | null = nodeId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const entry = t.delegateByNode.get(cur);
      if (entry) return entry;
      cur = t.nodes.get(cur)?.parentId ?? null;
    }
    return undefined;
  }

  /** Mark a session finished and persist a final snapshot. Called by the manager
   *  when a session is torn down (evicted/deleted) or a headless run completes. */
  finalize(sessionId: string, status: 'done' | 'error' = 'done'): void {
    const rec = this.records.get(sessionId);
    if (!rec) return;
    rec.status = status;
    rec.endedAt = Date.now();
    // Any still-open delegate is orphaned by teardown — settle it.
    for (const d of rec.delegates) if (d.status === 'running') d.status = status;
    this.flush(sessionId);
    this.tracking.delete(sessionId);
  }

  /** Newest-first snapshot of the ledger (bounded by `limit`). */
  list(limit = 200): SessionLedgerRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }
}
