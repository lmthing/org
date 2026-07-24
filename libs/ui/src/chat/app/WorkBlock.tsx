import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../lib/cn.js';
import { useStore } from '../store/store.js';
import {
  KIND_ICON,
  STATUS_COLOR,
  statusColorKey,
  fmtDuration,
  narrationOf,
  recentSubtreeStatements,
  subtreeStmtCount,
  workDepth,
} from './node-meta.js';

const MAX_DEPTH_INDENT = 3;
const STATUS_GLYPH: Record<string, string> = {
  running: '●',
  done: '✓',
  error: '✗',
  skipped: '–',
  queued: '○',
};

/** An inline, persistent conversation block for a sub-agent work node
 *  (delegate/fork/tasklist/task). Created by the model reducer on `node_start`,
 *  it streams the node's live status and narration while running and stays in
 *  the transcript (collapsed) when finished. */
export function WorkBlock({ nodeId }: { nodeId: string }): React.ReactElement | null {
  // `feedLive` mutates `model` in place without changing its reference, so key
  // the live re-render off `version` (the per-batch bump) — same pattern as
  // conversation.tsx / tree.tsx / inspector.tsx.
  useStore((s) => s.version);
  const model = useStore((s) => s.model);
  const selectNode = useStore((s) => s.selectNode);
  const setDevPanelOpen = useStore((s) => s.setDevPanelOpen);

  const node = model.nodes[nodeId];
  const isRunning = !!node && node.status !== 'done' && node.status !== 'error' && node.status !== 'skipped';

  // Rows start collapsed; expand the ones you want to watch.
  const [expanded, setExpanded] = React.useState<boolean>(false);
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);

  // Tick every 500 ms while running so the elapsed counter advances.
  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(forceTick, 500);
    return () => clearInterval(id);
  }, [isRunning]);

  if (!node) return null;

  const depth = Math.min(workDepth(model, nodeId), MAX_DEPTH_INDENT);
  const stmts = recentSubtreeStatements(model, nodeId, 2);
  const count = subtreeStmtCount(model, nodeId);
  const dur =
    node.endTs && node.startTs
      ? node.durationMs ?? node.endTs - node.startTs
      : node.startTs
        ? Date.now() - node.startTs
        : null;
  const colorKey = statusColorKey(node.status);
  // One-line live activity shown even while the row is collapsed, so the box
  // stays scannable without expanding every entry. An explicit setActivity()
  // from the sub-agent is authoritative; otherwise fall back to the //-comment
  // narration scraped from its most recent statement.
  const headline = node.activity || narrationOf(recentSubtreeStatements(model, nodeId, 1)[0]?.code ?? '');

  const openInspector = (): void => {
    selectNode(nodeId, true);
    setDevPanelOpen(true);
  };

  return (
    <Prim.Box
      className="py-1 lm-fade-in"
      style={{ paddingLeft: 16 + depth * 14, paddingRight: 16 }}
      data-testid="work-block"
      data-node-id={nodeId}
    >
      <Prim.Row className="gap-1.5 text-xs" alignItems="center" style={{ lineHeight: '1rem' }}>
        <Prim.Pressable
          onClick={() => setExpanded((v) => !v)}
          className="w-3 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Collapse work block' : 'Expand work block'}
        >
          {expanded ? '▾' : '▸'}
        </Prim.Pressable>
        <Prim.Text className="shrink-0" aria-hidden="true">
          {KIND_ICON[node.kind] ?? '◦'}
        </Prim.Text>
        <Prim.Pressable
          onClick={openInspector}
          className="max-w-[180px] shrink min-w-0 truncate text-left font-mono text-muted-foreground transition-colors hover:text-foreground"
          title={`${node.label} — open in inspector`}
        >
          {node.label}
        </Prim.Pressable>
        {headline && (
          <Prim.Text className="flex-1 min-w-0 truncate text-muted-foreground opacity-70" title={headline}>
            {headline}
          </Prim.Text>
        )}
        <Prim.Text
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5',
            STATUS_COLOR[colorKey] ?? STATUS_COLOR.done,
          )}
        >
          {isRunning && <Prim.Text className="lm-pulse">{STATUS_GLYPH[node.status] ?? '●'}</Prim.Text>}
          {!isRunning && <Prim.Text>{STATUS_GLYPH[node.status] ?? '◦'}</Prim.Text>}
          <Prim.Text className="capitalize">{node.status}</Prim.Text>
        </Prim.Text>
        {dur != null && (
          <Prim.Text className="shrink-0 text-muted-foreground opacity-70">{fmtDuration(dur)}</Prim.Text>
        )}
      </Prim.Row>

      {expanded && (
        <Prim.Box className="mt-1 space-y-0.5 pl-[26px] text-xs text-muted-foreground">
          {stmts.length > 0 ? (
            stmts.map((s, i) => {
              const text = narrationOf(s.code);
              return (
                <Prim.Box
                  key={`${s.ts}-${i}`}
                  className={cn('truncate', s.errors.length > 0 && 'text-destructive')}
                  title={text}
                >
                  {text || '(no narration)'}
                </Prim.Box>
              );
            })
          ) : (
            <Prim.Box className="italic opacity-70">{isRunning ? 'working…' : ''}</Prim.Box>
          )}
          {count > 0 && (
            <Prim.Box className="opacity-60">
              {count} statement{count === 1 ? '' : 's'}
            </Prim.Box>
          )}
          {node.error && (
            <Prim.Box className="truncate font-mono text-destructive" title={node.error}>
              {node.error}
            </Prim.Box>
          )}
        </Prim.Box>
      )}
    </Prim.Box>
  );
}
