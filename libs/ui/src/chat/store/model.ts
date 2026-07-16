import type { TraceEvent, TraceAttachment } from '@lmthing/core';

/** A user attachment as returned by POST /api/uploads and held by the composer
 *  until send. Superset of {@link TraceAttachment} with the server-side `id` the
 *  client echoes back so the server can re-read the stored bytes. */
export interface UploadedAttachment extends TraceAttachment {
  id: string;
}

// ─── Wire event (what the WS / trace file delivers) ─────────────────────────

export interface WireEvent {
  seq: number;
  event: TraceEvent;
}

// ─── Model types ─────────────────────────────────────────────────────────────

export type NodeStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';
export type NodeKind = 'session' | 'run' | 'fork' | 'delegate' | 'tasklist' | 'task';

export interface LlmCall {
  ts: number;
  model?: string;
  system: string;
  messages: Array<{ role: string; content: string }>;
  responses: Array<{ attempt: number; ts: number; text: string }>;
}

export interface StatementEntry {
  ts: number;
  code: string;
  errors: Array<{ phase: 'typecheck' | 'eval'; message: string; attempt?: number }>;
}

export interface YieldEntry {
  ts: number;
  yieldId?: string;
  kind: string;
  args: unknown;
  resolved: boolean;
  value?: unknown;
}

export interface ExecNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  label: string;
  status: NodeStatus;
  startTs?: number;
  endTs?: number;
  durationMs?: number;
  detail?: Record<string, unknown>;
  childIds: string[];
  depTaskIds: string[];
  queue?: { active: number; queued: number; max: number };
  llmCalls: LlmCall[];
  statements: StatementEntry[];
  yields: YieldEntry[];
  variables: Record<string, unknown>;
  result?: unknown;
  error?: string;
  eventSeqs: number[];
  /** Agent-authored live narration, set by this sub-agent's setActivity(). When
   *  present it is the authoritative "currently doing" line WorkBlock shows,
   *  overriding the //-comment `narrationOf` heuristic. Cleared by an empty
   *  setActivity('') and irrelevant once the node ends (it stops being active). */
  activity?: string;
}

export type ConvoBlock =
  | { id: string; ts: number; nodeId: string; type: 'user'; content: string; attachments?: TraceAttachment[] }
  | { id: string; ts: number; nodeId: string; type: 'display'; descriptor: unknown }
  | { id: string; ts: number; nodeId: string; type: 'error'; message: string }
  | { id: string; ts: number; nodeId: string; type: 'ask'; askId: string; descriptor: unknown; state: 'open' | 'answered' | 'cancelled'; answer?: unknown };

export interface SessionModel {
  nodes: Record<string, ExecNode>;
  rootId: string | null;
  blocks: ConvoBlock[];
  rawEvents: WireEvent[];
  lastSeq: number;
}

export function emptyModel(): SessionModel {
  return { nodes: {}, rootId: null, blocks: [], rawEvents: [], lastSeq: 0 };
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

function isTerminal(s: NodeStatus): boolean {
  return s === 'done' || s === 'error' || s === 'skipped';
}

function ensureNode(m: SessionModel, id: string): ExecNode {
  let n = m.nodes[id];
  if (!n) {
    n = {
      id, parentId: null, kind: 'fork', label: id, status: 'running',
      childIds: [], depTaskIds: [], llmCalls: [], statements: [], yields: [],
      variables: {}, eventSeqs: [],
    };
    m.nodes[id] = n;
  }
  return n;
}

/** The explicit nodeId an event carries, or null. Every trace event is now
 *  emitted with a real nodeId (session_start/node_start carry it, and hosts
 *  attribute node-less injected events — e.g. user_message — to the root).
 *  Events without a nodeId are conversation/ephemeral only and must NOT spawn
 *  a phantom node (doing so used to hijack rootId and hide the real tree). */
function nodeIdFor(ev: TraceEvent): string | null {
  return (ev as { nodeId?: string }).nodeId ?? null;
}

let blockCounter = 0;

/** Apply one wire event to the model (mutates in place). */
export function applyWireEvent(m: SessionModel, we: WireEvent): void {
  m.rawEvents.push(we);
  if (we.seq > m.lastSeq) m.lastSeq = we.seq;
  const ev = we.event;

  // Events that don't belong to a specific node — handle without minting one
  // (otherwise a node-less event spawns a phantom node that hijacks rootId).
  if (ev.type === 'fork_queue') {
    if (m.rootId) ensureNode(m, m.rootId).queue = { active: ev.active, queued: ev.queued, max: ev.max };
    return;
  }
  if (ev.type === 'llm_progress') {
    // Ephemeral / attach-only; record under its node if it has one, else ignore.
    const id = (ev as { nodeId?: string }).nodeId;
    if (id) ensureNode(m, id).eventSeqs.push(we.seq);
    return;
  }
  if (ev.type === 'activity') {
    // Session-scope drives the header's main "currently doing" line (handled in
    // the store slice). A fork/delegate scope sets that work node's authoritative
    // narration (shown by WorkBlock); an empty text clears it (falls back to the
    // //-comment narration). Ephemeral — no phantom node for a session-scope one.
    if (ev.scope !== 'session' && ev.nodeId) {
      ensureNode(m, ev.nodeId).activity = ev.text || undefined;
    }
    return;
  }
  if (ev.type === 'user_message') {
    // A conversation block, not an execution node. Attribute to its node (root)
    // if known; never mint a phantom node for it.
    const last = m.blocks[m.blocks.length - 1];
    if (last && last.type === 'user' && last.content === ev.content) {
      // Optimistic block already present — backfill server-resolved attachments
      // (with their served urls) if the optimistic push didn't have them.
      if (ev.attachments && !last.attachments) last.attachments = ev.attachments;
    } else {
      m.blocks.push({
        id: `b${++blockCounter}`,
        ts: ev.ts,
        nodeId: (ev as { nodeId?: string }).nodeId ?? m.rootId ?? '',
        type: 'user',
        content: ev.content,
        ...(ev.attachments ? { attachments: ev.attachments } : {}),
      });
    }
    return;
  }

  const nid = nodeIdFor(ev);
  if (!nid) return; // node-less event with no attribution — ignore, never phantom.
  const node = ensureNode(m, nid);
  node.eventSeqs.push(we.seq);

  switch (ev.type) {
    case 'session_start': {
      node.kind = 'session';
      node.label = 'session';
      if (!isTerminal(node.status)) node.status = 'running';
      node.startTs = ev.ts;
      if (!m.rootId) m.rootId = nid;
      break;
    }
    case 'node_start': {
      node.parentId = ev.parentId;
      node.kind = ev.kind;
      node.label = ev.label;
      if (!isTerminal(node.status)) node.status = ev.status;
      node.startTs = ev.ts;
      node.detail = ev.detail as Record<string, unknown> | undefined;
      if (ev.detail && Array.isArray((ev.detail as { dependsOn?: string[] }).dependsOn)) {
        node.depTaskIds = (ev.detail as { dependsOn?: string[] }).dependsOn ?? [];
      }
      if (ev.parentId) {
        const parent = ensureNode(m, ev.parentId);
        if (!parent.childIds.includes(nid)) parent.childIds.push(nid);
      } else if (!m.rootId) {
        m.rootId = nid;
      }
      break;
    }
    case 'node_update': {
      if (!isTerminal(node.status)) node.status = ev.status;
      break;
    }
    case 'node_end': {
      node.status = ev.status;
      node.endTs = ev.ts;
      node.durationMs = ev.durationMs;
      if (ev.error !== undefined) node.error = ev.error;
      if (ev.result !== undefined) node.result = ev.result;
      break;
    }
    case 'llm_request': {
      node.llmCalls.push({ ts: ev.ts, model: ev.model, system: ev.system, messages: ev.messages, responses: [] });
      break;
    }
    case 'llm_response': {
      const call = node.llmCalls[node.llmCalls.length - 1];
      if (call) call.responses.push({ attempt: ev.attempt, ts: ev.ts, text: ev.text });
      else node.llmCalls.push({ ts: ev.ts, system: '', messages: [], responses: [{ attempt: ev.attempt, ts: ev.ts, text: ev.text }] });
      break;
    }
    case 'statement': {
      node.statements.push({ ts: ev.ts, code: ev.code, errors: [] });
      break;
    }
    case 'typecheck_error': {
      const last = node.statements[node.statements.length - 1];
      if (last && last.code === ev.statement) last.errors.push({ phase: 'typecheck', message: ev.message, attempt: ev.attempt });
      else node.statements.push({ ts: ev.ts, code: ev.statement, errors: [{ phase: 'typecheck', message: ev.message, attempt: ev.attempt }] });
      break;
    }
    case 'eval_error': {
      const last = node.statements[node.statements.length - 1];
      if (last && last.code === ev.statement) last.errors.push({ phase: 'eval', message: ev.message });
      else node.statements.push({ ts: ev.ts, code: ev.statement, errors: [{ phase: 'eval', message: ev.message }] });
      break;
    }
    case 'yield': {
      node.yields.push({ ts: ev.ts, yieldId: ev.yieldId, kind: ev.kind, args: ev.args, resolved: false });
      break;
    }
    case 'yield_resolved': {
      const entry = ev.yieldId
        ? [...node.yields].reverse().find((y) => y.yieldId === ev.yieldId && !y.resolved)
        : [...node.yields].reverse().find((y) => y.kind === ev.kind && !y.resolved);
      if (entry) { entry.resolved = true; entry.value = ev.value; }
      break;
    }
    case 'variables': {
      node.variables = ev.vars;
      break;
    }
    case 'display': {
      m.blocks.push({ id: `b${++blockCounter}`, ts: ev.ts, nodeId: nid, type: 'display', descriptor: ev.descriptor });
      break;
    }
  }
}

export function buildModel(events: WireEvent[]): SessionModel {
  const m = emptyModel();
  for (const we of events) applyWireEvent(m, we);
  return m;
}

/** The ids of every node that has children — i.e. the nodes that must be in
 *  `expanded` for the tree to render its full hierarchy. Used after a wholesale
 *  model rebuild (snapshot / replay) so the tree doesn't collapse to one row. */
export function parentNodeIds(m: SessionModel): string[] {
  const ids: string[] = [];
  for (const id in m.nodes) {
    if (m.nodes[id]!.childIds.length > 0) ids.push(id);
  }
  return ids;
}

// ─── Conversation-block helpers (driven by interaction events, not trace) ────

export function pushUserBlock(m: SessionModel, content: string, attachments?: TraceAttachment[]): void {
  const nid = m.rootId ?? 'session';
  m.blocks.push({
    id: `b${++blockCounter}`,
    ts: Date.now(),
    nodeId: nid,
    type: 'user',
    content,
    ...(attachments && attachments.length ? { attachments } : {}),
  });
}

export function pushErrorBlock(m: SessionModel, message: string): void {
  const nid = m.rootId ?? 'session';
  m.blocks.push({ id: `b${++blockCounter}`, ts: Date.now(), nodeId: nid, type: 'error', message });
}

export function pushAskBlock(m: SessionModel, askId: string, descriptor: unknown): void {
  const nid = m.rootId ?? 'session';
  m.blocks.push({ id: `b${++blockCounter}`, ts: Date.now(), nodeId: nid, type: 'ask', askId, descriptor, state: 'open' });
}

export function resolveAskBlock(m: SessionModel, askId: string, answer: unknown, cancelled = false): void {
  const block = [...m.blocks].reverse().find((b): b is Extract<ConvoBlock, { type: 'ask' }> => b.type === 'ask' && b.askId === askId && b.state === 'open');
  if (block) { block.state = cancelled ? 'cancelled' : 'answered'; block.answer = answer; }
}
