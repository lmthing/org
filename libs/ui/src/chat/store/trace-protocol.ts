/**
 * The wire protocol for one agent-runtime trace event, as it reaches the chat
 * store over a WebSocket frame or a replayed NDJSON trace file.
 *
 * VENDORED (type-only) from `@lmthing/core`'s `libs/core/src/sandbox/trace.ts`
 * (previously imported as `import type { TraceEvent, TraceAttachment } from
 * '@lmthing/core'`) when `@lmthing/ui` severed its dependency on
 * `@lmthing/core`. These are erased at compile time — nothing here executes —
 * so the copy is exact but frozen: if core's `TraceEvent` union grows a new
 * variant, this copy needs the same edit by hand, since there is no longer a
 * single source of truth shared between the two packages. Only the type
 * declarations actually referenced by `@lmthing/ui` were copied
 * (`TraceEvent`, `TraceAttachment`, and their own dependencies `NodeKind`,
 * `NodeStatus`, `NodeDetail`); the `Tracer` class, `TraceScope` and node-id
 * minting in the original file are runtime machinery with no reader here.
 */

// ─── Node hierarchy types ──────────────────────────────────────────────────

export type NodeKind = 'session' | 'run' | 'fork' | 'delegate' | 'tasklist' | 'task';
export type NodeStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

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
  /** Truncated preview of the delegate's `query` input — so a downstream ledger
   *  can record "with what inputs" a delegation was made without re-plumbing opts. */
  query?: string;
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
  | { ts: number; type: 'llm_response'; context: string; nodeId?: string; attempt: number; text: string; model?: string; inputTokens?: number; outputTokens?: number; finishReason?: string }
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
  | { ts: number; type: 'session_meta'; nodeId?: string; title?: string; slug?: string }
  // New: the agent's live "currently doing" status via setActivity() — fire-and-forget,
  // does NOT end the turn. `scope: 'session'` is the MAIN line (THING); 'fork'/'delegate'
  // are SUB-activities keyed by `nodeId` (cleared on that node's `node_end`). `text: ''`
  // clears the scope's activity. Ephemeral (excluded from the NDJSON file below).
  | { ts: number; type: 'activity'; context: string; nodeId?: string; scope: 'session' | 'fork' | 'delegate'; text: string }
  // New: the session's VM was torn down OUT OF BAND (idle reaper, capacity/memory
  // eviction, or an explicit dispose). Recorded on the session so a disposal that races
  // an in-flight turn — the resume then throws the opaque QuickJS "Lifetime not alive" —
  // is diagnosable from the PERSISTED trace (runs/<n>/…/trace.json). The disposer's own
  // console.warn goes to server stderr, which run evidence discards; this event survives.
  | { ts: number; type: 'session_disposed'; nodeId?: string; sessionId: string; trigger: 'reaper' | 'evict' | 'explicit'; status: string };
