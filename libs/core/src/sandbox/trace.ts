import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// ─── Node hierarchy types ──────────────────────────────────────────────────

export type NodeKind = 'session' | 'run' | 'fork' | 'delegate' | 'tasklist' | 'task';
export type NodeStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

/** Per-call execution scope — generalizes today's flat traceContext string.
 *  `label` preserves the exact current format ('session', 'fork:<id>', etc.)
 *  so existing jq recipes keep working. */
export interface TraceScope {
  nodeId: string;
  parentId: string | null;
  /** Verbatim context label — written as `context` on all events. */
  label: string;
  startTs: number;
}

export interface NodeDetail {
  // fork
  role?: string;
  taskId?: string;
  instruction?: string;
  timeout?: number;
  // delegate
  pkg?: string;
  agent?: string;
  action?: string;
  depth?: number;
  // tasklist / task
  tasklist?: string;
  dependsOn?: string[];
  optional?: boolean;
  condition?: string;
  goal?: boolean;
  forEach?: string;
  forEachIndex?: number;
}

/** A user-message attachment as surfaced to the UI (via the `user_message`
 *  trace event). `url` points at the server's upload-serving route; `transcript`
 *  is present for audio (the text the model actually received). */
export interface TraceAttachment {
  kind: 'image' | 'audio' | 'file';
  url: string;
  mediaType: string;
  filename?: string;
  transcript?: string;
}

// ─── Trace event union ─────────────────────────────────────────────────────

export type TraceEvent =
  // Existing nine events — shape-preserved; each gains optional nodeId (additive)
  | { ts: number; type: 'session_start'; sessionId: string; spaceDir: string; agentSlug: string; nodeId?: string }
  | { ts: number; type: 'llm_request'; context: string; nodeId?: string; system: string; messages: Array<{ role: string; content: string }>; model?: string }
  | { ts: number; type: 'llm_response'; context: string; nodeId?: string; attempt: number; text: string; model?: string; inputTokens?: number; outputTokens?: number }
  | { ts: number; type: 'statement'; context: string; nodeId?: string; code: string }
  | { ts: number; type: 'typecheck_error'; context: string; nodeId?: string; statement: string; message: string; attempt: number }
  | { ts: number; type: 'eval_error'; context: string; nodeId?: string; statement: string; message: string }
  | { ts: number; type: 'yield'; context: string; nodeId?: string; kind: string; args: unknown; yieldId?: string }
  | { ts: number; type: 'yield_resolved'; context: string; nodeId?: string; kind: string; value: unknown; yieldId?: string }
  | { ts: number; type: 'turn_end'; context: string; nodeId?: string; reason: string }
  // New: execution-tree node lifecycle
  | { ts: number; type: 'node_start'; nodeId: string; parentId: string | null; kind: NodeKind; label: string; context: string; status: 'queued' | 'running'; detail?: NodeDetail }
  | { ts: number; type: 'node_update'; nodeId: string; status: NodeStatus }
  | { ts: number; type: 'node_end'; nodeId: string; status: 'done' | 'error' | 'skipped'; durationMs: number; error?: string; result?: unknown }
  // New: fork concurrency stats
  | { ts: number; type: 'fork_queue'; active: number; queued: number; max: number }
  // New: display attribution (which node emitted it)
  | { ts: number; type: 'display'; context: string; nodeId?: string; descriptor: unknown }
  // New: per-turn variable snapshots
  | { ts: number; type: 'variables'; context: string; nodeId?: string; vars: Record<string, unknown> }
  // New: throttled streaming progress — NOT written to file (kept in-memory only)
  | { ts: number; type: 'llm_progress'; context: string; nodeId?: string; chars: number; statements: number }
  // New: a user-sent chat message — captured in the trace so the conversation
  // (the user's prompts, not just display() output) reconstructs on reconnect/replay.
  // `attachments` carries any images/audio/files the user sent, so the UI can
  // re-render them in the user bubble on reconnect/replay.
  | { ts: number; type: 'user_message'; nodeId?: string; content: string; attachments?: TraceAttachment[] }
  // New: the agent named the session via setSessionMeta — the server ingests this
  // to update + persist the SessionEntry's title/slug (keeps core persistence-free).
  | { ts: number; type: 'session_meta'; nodeId?: string; title?: string; slug?: string };

/** Event types excluded from the NDJSON file (ephemeral, high-frequency). */
const FILE_EXCLUDED = new Set<TraceEvent['type']>(['llm_progress']);

// ─── Node ID minting ───────────────────────────────────────────────────────

let _nodeCounter = 0;

function mintNodeId(kind: NodeKind): string {
  const seq = ++_nodeCounter;
  const suffix = randomBytes(4).toString('hex');
  return `${kind}_${seq}_${suffix}`;
}

// ─── Tracer ────────────────────────────────────────────────────────────────

export class Tracer {
  private subscribers: Array<(e: TraceEvent) => void> = [];

  constructor(private path: string | null) {}

  write(event: TraceEvent): void {
    // File sink (all events except high-frequency ephemeral ones)
    if (this.path !== null && !FILE_EXCLUDED.has(event.type)) {
      try {
        appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8');
      } catch {
        // best-effort tracing — ignore write errors
      }
    }

    // Fan out to subscribers (sync, individually isolated)
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /* subscriber errors must not affect the turn loop */ }
    }
  }

  /** Subscribe to ALL trace events (incl. ephemeral ones like llm_progress).
   *  Returns an unsubscribe function. */
  subscribe(fn: (e: TraceEvent) => void): () => void {
    this.subscribers.push(fn);
    return () => {
      const idx = this.subscribers.indexOf(fn);
      if (idx !== -1) this.subscribers.splice(idx, 1);
    };
  }

  /** Create the root scope for a session (nodeId === sessionId). Does NOT emit
   *  node_start — the session already emits session_start which carries the id. */
  root(sessionId: string): TraceScope {
    return { nodeId: sessionId, parentId: null, label: 'session', startTs: Date.now() };
  }

  /** Mint a new child scope, emit node_start, and return the scope.
   *  Callers must call end() when the scope finishes. */
  child(
    parent: TraceScope | undefined,
    kind: NodeKind,
    label: string,
    detail?: NodeDetail,
    status: 'queued' | 'running' = 'running',
  ): TraceScope {
    const nodeId = mintNodeId(kind);
    const parentId = parent?.nodeId ?? null;
    const scope: TraceScope = { nodeId, parentId, label, startTs: Date.now() };
    this.write({
      ts: scope.startTs,
      type: 'node_start',
      nodeId,
      parentId,
      kind,
      label,
      context: label,
      status,
      detail,
    });
    return scope;
  }

  /** Transition a scope from 'queued' to 'running'. */
  activate(scope: TraceScope): void {
    this.write({ ts: Date.now(), type: 'node_update', nodeId: scope.nodeId, status: 'running' });
  }

  /** Emit node_end for a scope. */
  end(
    scope: TraceScope,
    status: 'done' | 'error' | 'skipped',
    extra?: { error?: string; result?: unknown },
  ): void {
    const durationMs = Date.now() - scope.startTs;
    this.write({
      ts: Date.now(),
      type: 'node_end',
      nodeId: scope.nodeId,
      status,
      durationMs,
      ...(extra?.error !== undefined ? { error: extra.error } : {}),
      ...(extra?.result !== undefined ? { result: extra.result } : {}),
    });
  }
}

export const NULL_TRACER = new Tracer(null);
