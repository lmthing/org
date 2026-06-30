import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildTraceTree } from '@lmthing/core';
import type { TraceTree, TreeNode, TraceEvent } from '@lmthing/core';
import type { TraceHub, SeqEvent } from '../rpc/trace-hub.js';
import type { UiControlAction } from '../rpc/events.js';
import type { SessionEntry } from '../server/session-manager.js';

/** Everything the agent API needs to read state and drive the session. */
export interface AgentApiContext {
  hub: TraceHub;
  spaceName: string;
  agentSlug: string;
  /** Send a user message (routes to start/continue). */
  sendMessage: (content: string) => void;
  /** Submit an open ask form. */
  submitForm: (id: string, value: unknown) => void;
  /** Cancel an open ask form. */
  cancelAsk: (id: string) => void;
  /** Currently-open ask forms. */
  pendingAsks: () => Array<{ id: string; nodeId?: string; descriptor: unknown }>;
  /** Broadcast a UI control action to connected browsers. */
  broadcastUiControl: (action: UiControlAction) => void;
}

/**
 * Build an AgentApiContext from a multi-session SessionEntry — reads/writes go
 * through THAT entry's own hub + renderHost, so the existing single-session
 * handlers work unchanged per-session. `sendMessage` routes through the manager
 * so start/continue + lastActivity/status bookkeeping stays centralized.
 */
export function agentApiContextFromEntry(
  entry: SessionEntry,
  deps: {
    sendMessage: (content: string) => void;
    broadcastUiControl: (action: UiControlAction) => void;
  },
): AgentApiContext {
  return {
    hub: entry.hub,
    spaceName: entry.spaceDir,
    agentSlug: entry.agentSlug,
    sendMessage: deps.sendMessage,
    submitForm: (id, value) => entry.renderHost.submitForm(id, value),
    cancelAsk: (id) => entry.renderHost.cancelAsk(id),
    pendingAsks: () => entry.renderHost.pendingAsks(),
    broadcastUiControl: deps.broadcastUiControl,
  };
}

const STATUS_GLYPH: Record<string, string> = {
  queued: '○',
  running: '⟳',
  done: '✓',
  error: '✗',
  skipped: '⊘',
};

// ─── Pure renderers (testable without HTTP) ──────────────────────────────────

const ms = (n?: number): string => (n === undefined ? '' : n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `… (${s.length} chars)`;
}

function retryCount(node: TreeNode): number {
  // Number of statements that hit a typecheck/eval error — each forces the turn
  // loop to re-stream, i.e. a retry. This is the direct "code failed" signal.
  return node.statements.filter((s) => s.errors.length > 0).length;
}

/** One-screen execution-tree summary as indented ASCII. */
export function renderState(tree: TraceTree, opts: { lastSeq: number; asks: Array<{ id: string; nodeId?: string; descriptor: unknown }> }): string {
  const lines: string[] = [];
  lines.push(`# LMThing session — lastSeq=${opts.lastSeq}`);
  lines.push('');
  lines.push('## Execution tree  (glyph id [kind] label  duration  retries)');

  const seen = new Set<string>();
  const renderNode = (id: string, depth: number): void => {
    const node = tree.nodes[id];
    if (!node || seen.has(id)) return;
    seen.add(id);
    const glyph = STATUS_GLYPH[node.status] ?? '?';
    const indent = '  '.repeat(depth);
    const retries = retryCount(node);
    const retryTag = retries > 0 ? `  ×${retries}` : '';
    const dur = node.durationMs !== undefined ? `  ${ms(node.durationMs)}` : '';
    const q = node.queueStats ? `  [q:${node.queueStats.active}/${node.queueStats.max}]` : '';
    lines.push(`${indent}${glyph} ${id} [${node.kind}] ${node.label}${dur}${retryTag}${q}`);
    if (node.error) lines.push(`${indent}    error: ${truncate(node.error, 200)}`);
    for (const childId of node.childIds) renderNode(childId, depth + 1);
  };

  if (tree.rootId) renderNode(tree.rootId, 0);
  // Render any orphan nodes (no parent path from root)
  for (const id of Object.keys(tree.nodes)) {
    if (!seen.has(id) && tree.nodes[id]!.parentId === null) renderNode(id, 0);
  }
  for (const id of Object.keys(tree.nodes)) if (!seen.has(id)) renderNode(id, 0);

  lines.push('');
  if (opts.asks.length > 0) {
    lines.push('## Pending asks (use POST /api/ask/<id>)');
    for (const a of opts.asks) lines.push(`- ${a.id}${a.nodeId ? ` @ ${a.nodeId}` : ''}: ${truncate(JSON.stringify(a.descriptor), 200)}`);
  } else {
    lines.push('## Pending asks: none');
  }

  return lines.join('\n');
}

/** Detail view of a single node, by tab. */
export function renderNodeDetail(
  tree: TraceTree,
  nodeId: string,
  tab: string,
  opts: { limit?: number; offset?: number } = {},
): string {
  const node = tree.nodes[nodeId];
  if (!node) return `node "${nodeId}" not found`;

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const lines: string[] = [];
  lines.push(`# ${nodeId} [${node.kind}] ${node.label}  status=${node.status}${node.durationMs !== undefined ? `  ${ms(node.durationMs)}` : ''}`);
  if (node.detail) lines.push(`detail: ${JSON.stringify(node.detail)}`);
  lines.push('');

  switch (tab) {
    case 'llm': {
      lines.push(`## LLM calls (${node.llmCalls.length})`);
      for (const [i, c] of node.llmCalls.slice(offset, offset + limit).entries()) {
        lines.push(`### call ${offset + i} model=${c.model ?? 'default'} responses=${c.responses.length}`);
        for (const r of c.responses) {
          lines.push(`  [attempt ${r.attempt}] ${truncate(r.text, 400)}`);
        }
      }
      break;
    }
    case 'statements': {
      lines.push(`## Statements (${node.statements.length})`);
      for (const s of node.statements.slice(offset, offset + limit)) {
        lines.push(`- ${truncate(s.code, 300)}`);
        for (const e of s.errors) lines.push(`    ${e.phase} error: ${truncate(e.message, 200)}`);
      }
      break;
    }
    case 'yields': {
      lines.push(`## Yields (${node.yields.length})`);
      for (const y of node.yields.slice(offset, offset + limit)) {
        const status = y.resolved ? '✓' : '⟳';
        lines.push(`- ${status} ${y.kind}  args=${truncate(JSON.stringify(y.args), 200)}`);
        if (y.resolved) lines.push(`    → ${truncate(JSON.stringify(y.value), 300)}`);
      }
      break;
    }
    case 'variables': {
      lines.push('## Variables (latest snapshot)');
      for (const [k, v] of Object.entries(node.variables)) {
        lines.push(`- ${k}: ${truncate(JSON.stringify(v), 300)}`);
      }
      break;
    }
    case 'raw': {
      lines.push(`## Raw events (${node.eventIdxs.length})`);
      for (const idx of node.eventIdxs.slice(offset, offset + limit)) {
        const ev = tree.rawEvents[idx];
        if (ev) lines.push(truncate(JSON.stringify(ev), 400));
      }
      break;
    }
    default:
      lines.push(`unknown tab "${tab}" — use llm|statements|yields|variables|raw`);
  }

  if (node.result !== undefined) {
    lines.push('');
    lines.push(`## Result: ${truncate(JSON.stringify(node.result), 400)}`);
  }
  return lines.join('\n');
}

export const HELP_TEXT = `LMThing web observability — agent quickstart (prefer curl; no browser needed)

GET  /api/state                          tree + pending asks + lastSeq (plain text)
GET  /api/node/<nodeId>?tab=TAB          TAB = llm|statements|yields|variables|raw  (&limit&offset)
GET  /api/events?since=<seq>             incremental tail; &type=csv &node=<id> &limit=N
GET  /api/asks                           open ask forms with descriptors
POST /api/message      {"content":"…"}   send a user message (start, then continue)
POST /api/ask/<id>     {"value":…}       answer an open form
DELETE /api/ask/<id>                     cancel an open form
POST /api/ui           {"select":"<nodeId>","tab":"llm"}   drive the human browser
                       other actions: {"follow":true} {"seek":<seq>} {"tab":"yields"}

Add ?format=json to any GET for JSON instead of text.

Typical loop:
  1. curl -s localhost:PORT/api/state                       # orient
  2. curl -s "localhost:PORT/api/node/<id>?tab=statements"  # drill in
  3. curl -s "localhost:PORT/api/events?since=<lastSeq>"    # poll for changes
  4. curl -s -X POST localhost:PORT/api/message -d '{"content":"…"}' -H 'content-type: application/json'

Browser fallback: every view is a URL — http://localhost:PORT/?node=<id>&tab=yields
Tree rows carry data-node-id attributes for snapshot-based control.
`;

// ─── HTTP handler ────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** Returns true if the request was an /api/* route and was handled. */
export async function handleAgentApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AgentApiContext,
  opts: {
    /** When set, route matching uses this path instead of req.url's pathname.
     *  The multi-session server maps /api/sessions/:id/state → /api/state so all
     *  the existing per-route handlers below are reused unchanged. */
    pathOverride?: string;
  } = {},
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = opts.pathOverride ?? url.pathname;
  if (!path.startsWith('/api/')) return false;

  const method = req.method ?? 'GET';
  const format = url.searchParams.get('format') ?? 'text';
  const wantJson = format === 'json';

  const tree = (): TraceTree => buildTraceTree(ctx.hub.snapshot().events.map((e) => e.event));

  try {
    // GET /api/help
    if (path === '/api/help' && method === 'GET') {
      sendText(res, 200, HELP_TEXT);
      return true;
    }

    // GET /api/state
    if (path === '/api/state' && method === 'GET') {
      const t = tree();
      const asks = ctx.pendingAsks();
      if (wantJson) {
        sendJson(res, 200, { lastSeq: ctx.hub.lastSeq, rootId: t.rootId, nodes: t.nodes, asks });
      } else {
        sendText(res, 200, renderState(t, { lastSeq: ctx.hub.lastSeq, asks }));
      }
      return true;
    }

    // GET /api/node/<id>?tab=
    if (path.startsWith('/api/node/') && method === 'GET') {
      const nodeId = decodeURIComponent(path.slice('/api/node/'.length));
      const tab = url.searchParams.get('tab') ?? 'statements';
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const t = tree();
      if (wantJson) {
        sendJson(res, 200, t.nodes[nodeId] ?? { error: `node "${nodeId}" not found` });
      } else {
        sendText(res, 200, renderNodeDetail(t, nodeId, tab, { limit, offset }));
      }
      return true;
    }

    // GET /api/events?since=
    if (path === '/api/events' && method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? '0');
      const typeFilter = url.searchParams.get('type')?.split(',').map((s) => s.trim()).filter(Boolean);
      const nodeFilter = url.searchParams.get('node');
      const limit = Number(url.searchParams.get('limit') ?? '500');
      let events: SeqEvent[] = ctx.hub.snapshotSince(since).events;
      if (typeFilter && typeFilter.length > 0) events = events.filter((e) => typeFilter.includes(e.event.type));
      if (nodeFilter) events = events.filter((e) => (e.event as { nodeId?: string }).nodeId === nodeFilter);
      events = events.slice(0, limit);
      if (wantJson) {
        sendJson(res, 200, { events, lastSeq: ctx.hub.lastSeq });
      } else {
        const body = [`lastSeq=${ctx.hub.lastSeq}`, ...events.map((e) => `[${e.seq}] ${formatEventLine(e.event)}`)].join('\n');
        sendText(res, 200, body);
      }
      return true;
    }

    // GET /api/asks
    if (path === '/api/asks' && method === 'GET') {
      const asks = ctx.pendingAsks();
      if (wantJson) sendJson(res, 200, { asks });
      else sendText(res, 200, asks.length ? asks.map((a) => `${a.id}${a.nodeId ? ` @ ${a.nodeId}` : ''}: ${JSON.stringify(a.descriptor)}`).join('\n') : 'no pending asks');
      return true;
    }

    // POST /api/message
    if (path === '/api/message' && method === 'POST') {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}') as { content?: string };
      if (typeof parsed.content !== 'string') { sendJson(res, 400, { error: 'missing content' }); return true; }
      ctx.sendMessage(parsed.content);
      sendJson(res, 202, { ok: true });
      return true;
    }

    // POST /api/ask/<id>  /  DELETE /api/ask/<id>
    if (path.startsWith('/api/ask/')) {
      const id = decodeURIComponent(path.slice('/api/ask/'.length));
      if (method === 'POST') {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}') as { value?: unknown };
        ctx.submitForm(id, parsed.value);
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        ctx.cancelAsk(id);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    // POST /api/ui
    if (path === '/api/ui' && method === 'POST') {
      const body = await readBody(req);
      const action = JSON.parse(body || '{}') as UiControlAction;
      ctx.broadcastUiControl(action);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: `unknown API route ${method} ${path}` });
    return true;
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

function formatEventLine(ev: TraceEvent): string {
  const node = (ev as { nodeId?: string }).nodeId;
  const nodeTag = node ? ` @${node}` : '';
  switch (ev.type) {
    case 'node_start': return `node_start ${ev.kind} "${ev.label}"${nodeTag} parent=${ev.parentId ?? '-'}`;
    case 'node_end': return `node_end ${ev.status}${nodeTag} ${ms(ev.durationMs)}`;
    case 'statement': return `statement${nodeTag} ${truncate(ev.code, 100)}`;
    case 'yield': return `yield ${ev.kind}${nodeTag}`;
    case 'yield_resolved': return `yield_resolved ${ev.kind}${nodeTag}`;
    case 'display': return `display${nodeTag}`;
    case 'llm_response': return `llm_response attempt=${ev.attempt}${nodeTag}`;
    default: return `${ev.type}${nodeTag}`;
  }
}
