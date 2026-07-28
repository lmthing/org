import type { SessionModel, StatementEntry, NodeKind, ExecNode } from '../store/model';

/** Node kinds that represent sub-agent work (delegates/forks/tasklists/tasks). */
export const WORK_KINDS = new Set<NodeKind>(['fork', 'delegate', 'tasklist', 'task']);

// ─── Presentation constants (single source of truth) ────────────────────────
// Shared by ActivityStrip (chips under ask forms) and the REPL chat's work rows.
// Previously these lived inline in ActivityStrip.tsx.

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
 *  running or queued), sorted oldest-first. Nothing here is persisted into
 *  `model.blocks`. */
export function selectActiveWork(m: SessionModel): ExecNode[] {
  const out: ExecNode[] = [];
  for (const id in m.nodes) {
    const n = m.nodes[id];
    if (n && WORK_KINDS.has(n.kind) && (n.status === 'running' || n.status === 'queued')) out.push(n);
  }
  out.sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));
  return out;
}

/** The ONE in-flight node that answers "what is being done right now?": a
 *  running node beats a merely queued one, and among those the most recently
 *  started wins (the innermost thing that just began). Undefined when idle. */
export function currentWorkNode(m: SessionModel): ExecNode | undefined {
  let best: ExecNode | undefined;
  for (const n of selectActiveWork(m)) {
    if (!best) { best = n; continue; }
    const nRunning = n.status === 'running';
    if (nRunning !== (best.status === 'running')) {
      if (nRunning) best = n;
      continue;
    }
    if ((n.startTs ?? 0) >= (best.startTs ?? 0)) best = n;
  }
  return best;
}

/** ONE sentence for the current sub-agent work — the whole of what the chat
 *  shows about delegation now (the indented tree of work blocks is gone: on a
 *  phone it was a wall of rows nobody could act on). The sub-agent's own
 *  `setActivity()` text wins; otherwise the `//`-comment narration of its newest
 *  statement anywhere in the subtree; otherwise its label. '' when idle. */
export function currentWorkSentence(m: SessionModel): string {
  const node = currentWorkNode(m);
  if (!node) return '';
  const headline = node.activity || narrationOf(latestSubtreeStatement(m, node.id)?.code ?? '');
  return headline || `${node.label}…`;
}
