import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { useStore } from '../store/store.js';
import type { ExecNode } from '../store/model.js';
import { StatusIcon, KindBadge, fmtDuration } from './common.js';

/** A ticking "now" so running-node durations update live without re-rendering the tree. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function TreeRow({ node, depth, now }: { node: ExecNode; depth: number; now: number }): React.ReactElement {
  const selected = useStore((s) => s.selectedNodeId === node.id);
  const expanded = useStore((s) => s.expanded.has(node.id));
  const selectNode = useStore((s) => s.selectNode);
  const toggleExpand = useStore((s) => s.toggleExpand);
  const childIds = useStore((s) => s.model.nodes[node.id]?.childIds ?? []);

  const dur = node.durationMs !== undefined
    ? fmtDuration(node.durationMs)
    : node.startTs !== undefined && node.status === 'running'
      ? fmtDuration(now - node.startTs)
      : '';
  const retries = node.statements.filter((st) => st.errors.length > 0).length;

  return (
    <Prim.Box>
      <Prim.Box
        data-testid="tree-node"
        data-node-id={node.id}
        data-status={node.status}
        onClick={() => selectNode(node.id, true)}
        className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded text-[12px] ${
          selected ? 'bg-lm-accent/15 ring-1 ring-lm-accent/40' : 'hover:bg-lm-panel2'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {childIds.length > 0 ? (
          <Prim.Pressable
            onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
            className="text-lm-muted w-3 text-center shrink-0"
            aria-label={expanded ? 'collapse' : 'expand'}
          >
            {expanded ? '▾' : '▸'}
          </Prim.Pressable>
        ) : (
          <Prim.Text className="w-3 shrink-0" />
        )}
        <StatusIcon status={node.status} />
        <Prim.Text className="truncate text-lm-text" title={node.label}>{node.label}</Prim.Text>
        <KindBadge kind={node.kind} />
        {dur && <Prim.Text className="text-lm-muted text-[10px] font-mono ml-auto shrink-0">{dur}</Prim.Text>}
        {retries > 0 && <Prim.Text className="text-lm-amber text-[10px] font-mono shrink-0" title={`${retries} retries`}>×{retries}</Prim.Text>}
      </Prim.Box>
      {expanded && childIds.map((cid) => <TreeRowById key={cid} id={cid} depth={depth + 1} now={now} />)}
    </Prim.Box>
  );
}

function TreeRowById({ id, depth, now }: { id: string; depth: number; now: number }): React.ReactElement | null {
  const node = useStore((s) => s.model.nodes[id]);
  if (!node) return null;
  return <TreeRow node={node} depth={depth} now={now} />;
}

export function ExecutionTree(): React.ReactElement {
  // Subscribe to version so the tree re-renders as the model mutates.
  useStore((s) => s.version);
  const rootId = useStore((s) => s.model.rootId);
  const queue = useStore((s) => (s.model.rootId ? s.model.nodes[s.model.rootId]?.queue : undefined));
  const anyRunning = useStore((s) => Object.values(s.model.nodes).some((n) => n.status === 'running'));
  const now = useNow(anyRunning);

  return (
    <Prim.Box as="nav" aria-label="execution tree" className="h-full overflow-y-auto py-1">
      <Prim.Row className="px-2 py-1 text-[10px] uppercase tracking-wider text-lm-muted justify-between" alignItems="center">
        <Prim.Text>Execution</Prim.Text>
        {queue && <Prim.Text className="font-mono">q {queue.active}/{queue.max}</Prim.Text>}
      </Prim.Row>
      {rootId ? <TreeRowById id={rootId} depth={0} now={now} /> : (
        <Prim.Box className="px-3 py-4 text-lm-muted text-[12px]">No activity yet. Send a message to start.</Prim.Box>
      )}
    </Prim.Box>
  );
}
