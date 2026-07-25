import type { SessionModel, StatementEntry, NodeStatus, NodeKind, ExecNode } from '../store/model.js';

/** Node kinds that represent sub-agent work (delegates/forks/tasklists/tasks). */
export const WORK_KINDS = new Set<NodeKind>(['fork', 'delegate', 'tasklist', 'task']);

// ─── Presentation constants (single source of truth) ────────────────────────
// Shared by ActivityStrip (chips under ask forms) and WorkBlock (inline chat
// blocks). Previously these lived inline in ActivityStrip.tsx.

export const KIND_ICON: Record<string, string> = {
  run: '⟳',
  fork: '⑂',
  delegate: '⤷',
  tasklist: '☰',
  session: '◉',
};

/**
 * Status chip styling as `$`-token PROP BAGS rather than class strings — a lookup table of
 * classNames is still a className at the call site, so it blocked the P3 codemod
 * (docs/tamagui-idiomatic-migration.md §5). Alpha values use the same web `color-mix` the element
 * conversions use.
 */
export const STATUS_COLOR: Record<string, Record<string, string>> = {
  running: {
    color: '$brand-2',
    backgroundColor: 'color-mix(in srgb, var(--brand-2) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--brand-2) 30%, transparent)',
  },
  done: { color: '$muted-foreground', backgroundColor: '$muted', borderColor: '$border' },
  error: {
    color: '$destructive',
    backgroundColor: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)',
  },
  pending: { color: '$muted-foreground', backgroundColor: '$muted', borderColor: '$border' },
};

/** Map a node status onto a STATUS_COLOR key (queued → pending, skipped → done). */
export function statusColorKey(status: NodeStatus): string {
  if (status === 'queued') return 'pending';
  if (status === 'skipped') return 'done';
  return status;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Narration ───────────────────────────────────────────────────────────────

/** Extract the human narration from a streamed statement. By convention the
 *  agent narrates with a leading `// comment`; fall back to the first code line
 *  when there isn't one so the row is never empty. */
export function narrationOf(code: string): string {
  if (!code) return '';
  const lines = code.split('\n');
  // Collect a run of leading `//` comment lines.
  const commentLines: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('//')) {
      commentLines.push(line.replace(/^\/\//, '').trim());
    } else if (line === '') {
      continue;
    } else {
      break;
    }
  }
  const text = commentLines.length > 0
    ? commentLines.join(' ')
    : lines.find((l) => l.trim() !== '')?.trim() ?? '';
  return text.slice(0, 160);
}

// ─── Subtree helpers ─────────────────────────────────────────────────────────
// A delegate's statements are attributed to its inner `run` child, not the
// delegate node itself — so "what is this work doing right now?" must look at
// the whole subtree, not the node's own `.statements`.

function visitSubtree(m: SessionModel, nodeId: string, fn: (id: string) => void): void {
  const stack = [nodeId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    fn(id);
    const node = m.nodes[id];
    if (node) for (const childId of node.childIds) stack.push(childId);
  }
}

/** The statement with the greatest `ts` anywhere in the subtree (the node's
 *  current activity), or undefined if the subtree has no statements. */
export function latestSubtreeStatement(m: SessionModel, nodeId: string): StatementEntry | undefined {
  let best: StatementEntry | undefined;
  visitSubtree(m, nodeId, (id) => {
    const node = m.nodes[id];
    if (!node) return;
    for (const s of node.statements) {
      if (!best || s.ts > best.ts) best = s;
    }
  });
  return best;
}

/** The last `n` statements in the subtree by `ts` (ascending — oldest first). */
export function recentSubtreeStatements(m: SessionModel, nodeId: string, n: number): StatementEntry[] {
  const all: StatementEntry[] = [];
  visitSubtree(m, nodeId, (id) => {
    const node = m.nodes[id];
    if (node) all.push(...node.statements);
  });
  all.sort((a, b) => a.ts - b.ts);
  return all.slice(-n);
}

/** Total statements across the subtree. */
export function subtreeStmtCount(m: SessionModel, nodeId: string): number {
  let count = 0;
  visitSubtree(m, nodeId, (id) => {
    const node = m.nodes[id];
    if (node) count += node.statements.length;
  });
  return count;
}

/** Number of work-kind ancestors — used to indent nested work blocks
 *  (delegate ▸ tasklist ▸ fork). Walks parentId, not full subtree. */
export function workDepth(m: SessionModel, nodeId: string): number {
  let depth = 0;
  let cur = m.nodes[nodeId]?.parentId ?? null;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const node = m.nodes[cur];
    if (node && node.kind !== 'session' && node.kind !== 'run') depth++;
    cur = node?.parentId ?? null;
  }
  return depth;
}

/** All currently in-flight work nodes (fork/delegate/tasklist/task that are
 *  running or queued), sorted oldest-first. Drives the ephemeral LiveActivity
 *  box — nothing here is persisted into `model.blocks`. */
export function selectActiveWork(m: SessionModel): ExecNode[] {
  const out: ExecNode[] = [];
  for (const id in m.nodes) {
    const n = m.nodes[id];
    if (n && WORK_KINDS.has(n.kind) && (n.status === 'running' || n.status === 'queued')) out.push(n);
  }
  out.sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));
  return out;
}
