import type { TraceEvent, NodeKind, NodeStatus, NodeDetail } from './trace.js';

// ─── Tree node types ───────────────────────────────────────────────────────

export interface LlmCall {
  requestId: string;
  ts: number;
  model?: string;
  system: string;
  messages: Array<{ role: string; content: string }>;
  responses: Array<{ attempt: number; ts: number; text: string }>;
  status: 'pending' | 'done';
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
  resolvedTs?: number;
}

export interface DisplayEntry {
  ts: number;
  descriptor: unknown;
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  label: string;
  status: NodeStatus;
  startTs?: number;
  endTs?: number;
  durationMs?: number;
  detail?: NodeDetail;
  childIds: string[];
  /** IDs of tasklist tasks this task depends on (from tasklist pre-declaration). */
  depTaskIds: string[];
  queueStats?: { active: number; queued: number; max: number };
  llmCalls: LlmCall[];
  statements: StatementEntry[];
  yields: YieldEntry[];
  variables: Record<string, unknown>;
  displays: DisplayEntry[];
  result?: unknown;
  error?: string;
  /** Indexes into TraceTree.rawEvents for the Raw inspector tab. */
  eventIdxs: number[];
}

export interface TraceTree {
  /** All nodes keyed by nodeId. */
  nodes: Record<string, TreeNode>;
  /** ID of the root (session) node, if present. */
  rootId: string | null;
  /** All events in order (rawEvents[i] is indexed by TreeNode.eventIdxs). */
  rawEvents: TraceEvent[];
  /** Highest seq seen (for incremental tailing). */
  lastSeq: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Parse a context label into a best-effort synthetic nodeId for legacy events. */
function legacyNodeIdFromContext(context: string, seenContexts: Map<string, number>): string {
  const count = (seenContexts.get(context) ?? 0) + 1;
  seenContexts.set(context, count);
  return `legacy_${context.replace(/[^a-zA-Z0-9_]/g, '_')}_${count}`;
}

function isTerminal(status: NodeStatus): boolean {
  return status === 'done' || status === 'error' || status === 'skipped';
}

function ensureNode(tree: TraceTree, nodeId: string): TreeNode {
  if (!tree.nodes[nodeId]) {
    tree.nodes[nodeId] = {
      id: nodeId,
      parentId: null,
      kind: 'fork',
      label: nodeId,
      status: 'running',
      childIds: [],
      depTaskIds: [],
      llmCalls: [],
      statements: [],
      yields: [],
      variables: {},
      displays: [],
      eventIdxs: [],
    };
  }
  return tree.nodes[nodeId]!;
}

/** Returns the LLM call for a request (identified by first-seen order per node). */
function findOrCreateLlmCall(node: TreeNode, requestId: string, ts: number, event: { system: string; messages: Array<{ role: string; content: string }>; model?: string }): LlmCall {
  let call = node.llmCalls.find((c) => c.requestId === requestId);
  if (!call) {
    call = { requestId, ts, model: event.model, system: event.system, messages: event.messages, responses: [], status: 'pending' };
    node.llmCalls.push(call);
  }
  return call;
}

// ─── Core reducer ─────────────────────────────────────────────────────────

/** Apply a single TraceEvent to the tree (mutates in place). */
export function applyEvent(tree: TraceTree, event: TraceEvent, seq = 0): void {
  tree.rawEvents.push(event);
  if (seq > tree.lastSeq) tree.lastSeq = seq;

  const evIdx = tree.rawEvents.length - 1;

  switch (event.type) {
    case 'session_start': {
      // Use legacyIdForContext for consistency: subsequent legacy events with
      // context:'session' must resolve to the same nodeId via legacyIdForContext.
      const nodeId = event.nodeId ?? legacyIdForContext(tree, 'session');
      const node = ensureNode(tree, nodeId);
      node.kind = 'session';
      node.label = 'session';
      if (!isTerminal(node.status)) node.status = 'running';
      node.startTs = event.ts;
      node.eventIdxs.push(evIdx);
      if (!tree.rootId) tree.rootId = nodeId;
      break;
    }

    case 'node_start': {
      const node = ensureNode(tree, event.nodeId);
      node.parentId = event.parentId;
      node.kind = event.kind;
      node.label = event.label;
      // Don't downgrade a terminal status set by an out-of-order node_end
      if (!isTerminal(node.status)) node.status = event.status;
      node.startTs = event.ts;
      node.detail = event.detail;
      node.eventIdxs.push(evIdx);
      // Link to parent
      if (event.parentId) {
        const parent = ensureNode(tree, event.parentId);
        if (!parent.childIds.includes(event.nodeId)) parent.childIds.push(event.nodeId);
      } else if (!tree.rootId) {
        tree.rootId = event.nodeId;
      }
      break;
    }

    case 'node_update': {
      const node = ensureNode(tree, event.nodeId);
      node.status = event.status;
      node.eventIdxs.push(evIdx);
      break;
    }

    case 'node_end': {
      const node = ensureNode(tree, event.nodeId);
      node.status = event.status;
      node.endTs = event.ts;
      node.durationMs = event.durationMs;
      if (event.error !== undefined) node.error = event.error;
      if (event.result !== undefined) node.result = event.result;
      node.eventIdxs.push(evIdx);
      break;
    }

    case 'fork_queue': {
      // Attach queue stats to the most recently started fork node, or the root
      const targetId = tree.rootId;
      if (targetId) {
        const node = ensureNode(tree, targetId);
        node.queueStats = { active: event.active, queued: event.queued, max: event.max };
      }
      break;
    }

    case 'llm_request': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      // Use index as requestId (llm_response is matched by position when no explicit id)
      const requestId = `req_${node.llmCalls.length}`;
      findOrCreateLlmCall(node, requestId, event.ts, event);
      break;
    }

    case 'llm_response': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      // Find the last pending llm call
      const pendingCall = [...node.llmCalls].reverse().find((c) => c.status === 'pending');
      if (pendingCall) {
        pendingCall.responses.push({ attempt: event.attempt, ts: event.ts, text: event.text });
        if (event.attempt >= 1) pendingCall.status = 'done';
      } else {
        // Orphan response — create a synthetic call record
        const call: LlmCall = {
          requestId: `req_${node.llmCalls.length}`,
          ts: event.ts,
          system: '',
          messages: [],
          responses: [{ attempt: event.attempt, ts: event.ts, text: event.text }],
          status: 'done',
        };
        node.llmCalls.push(call);
      }
      break;
    }

    case 'statement': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      node.statements.push({ ts: event.ts, code: event.code, errors: [] });
      break;
    }

    case 'typecheck_error': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      const last = node.statements.at(-1);
      if (last && last.code === event.statement) {
        last.errors.push({ phase: 'typecheck', message: event.message, attempt: event.attempt });
      } else {
        node.statements.push({ ts: event.ts, code: event.statement, errors: [{ phase: 'typecheck', message: event.message, attempt: event.attempt }] });
      }
      break;
    }

    case 'eval_error': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      const last = node.statements.at(-1);
      if (last && last.code === event.statement) {
        last.errors.push({ phase: 'eval', message: event.message });
      } else {
        node.statements.push({ ts: event.ts, code: event.statement, errors: [{ phase: 'eval', message: event.message }] });
      }
      break;
    }

    case 'yield': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      node.yields.push({ ts: event.ts, yieldId: event.yieldId, kind: event.kind, args: event.args, resolved: false });
      break;
    }

    case 'yield_resolved': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      // Match by yieldId first, then last unresolved of the same kind
      const entry = event.yieldId
        ? node.yields.find((y) => y.yieldId === event.yieldId && !y.resolved)
        : [...node.yields].reverse().find((y) => y.kind === event.kind && !y.resolved);
      if (entry) {
        entry.resolved = true;
        entry.value = event.value;
        entry.resolvedTs = event.ts;
      }
      break;
    }

    case 'display': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      node.displays.push({ ts: event.ts, descriptor: event.descriptor });
      break;
    }

    case 'variables': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      node.variables = event.vars;
      break;
    }

    case 'turn_end': {
      const nodeId = event.nodeId ?? legacyIdForContext(tree, event.context);
      const node = ensureNode(tree, nodeId);
      node.eventIdxs.push(evIdx);
      break;
    }

    case 'llm_progress':
      // Attach to node if present; otherwise ignore
      if ('nodeId' in event && event.nodeId) {
        const node = ensureNode(tree, event.nodeId);
        node.eventIdxs.push(evIdx);
      }
      break;
  }
}

// Per-tree legacy context-to-nodeId mapping (used for old traces without nodeId)
const legacyMaps = new WeakMap<TraceTree, Map<string, string>>();

function legacyIdForContext(tree: TraceTree, context: string): string {
  if (!legacyMaps.has(tree)) legacyMaps.set(tree, new Map());
  const map = legacyMaps.get(tree)!;

  if (!map.has(context)) {
    // Derive a stable synthetic nodeId from the context label
    const base = context.replace(/[^a-zA-Z0-9_]/g, '_');
    map.set(context, `legacy_${base}`);

    // Wire up parent relationships for known patterns
    const node = ensureNode(tree, `legacy_${base}`);
    node.label = context;
    if (context === 'session') {
      node.kind = 'session';
      if (!tree.rootId) tree.rootId = node.id;
    } else if (context.startsWith('fork:')) {
      node.kind = 'fork';
      // Parent is the session node if we have one
      const sessionId = map.get('session') ?? (tree.rootId ?? null);
      if (sessionId && sessionId !== node.id) {
        node.parentId = sessionId;
        const parent = ensureNode(tree, sessionId);
        if (!parent.childIds.includes(node.id)) parent.childIds.push(node.id);
      }
    } else if (context.startsWith('delegate:')) {
      node.kind = 'delegate';
      const sessionId = map.get('session') ?? (tree.rootId ?? null);
      if (sessionId && sessionId !== node.id) {
        node.parentId = sessionId;
        const parent = ensureNode(tree, sessionId);
        if (!parent.childIds.includes(node.id)) parent.childIds.push(node.id);
      }
    }
  }

  return map.get(context)!;
}

// ─── Build from event array ────────────────────────────────────────────────

/** Build a TraceTree from an ordered array of TraceEvents.
 *  Pure and dependency-free — safe for browser import. */
export function buildTraceTree(events: TraceEvent[]): TraceTree {
  const tree: TraceTree = {
    nodes: {},
    rootId: null,
    rawEvents: [],
    lastSeq: 0,
  };
  for (const event of events) {
    applyEvent(tree, event);
  }
  return tree;
}
