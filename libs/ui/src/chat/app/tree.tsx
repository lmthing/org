import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import type { ExecNode } from '../store/model';
import { StatusIcon, KindBadge, fmtDuration } from './common';

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
        display="flex"
        alignItems="center"
        gap="$1.5"
        paddingHorizontal="$2"
        paddingVertical="$1"
        cursor="pointer"
        borderRadius="$radius"
        fontSize="12px"
        {...(selected
          ? {
              backgroundColor: 'color-mix(in srgb, var(--lm-accent) 15%, transparent)',
              outlineWidth: 1,
              outlineStyle: 'solid' as const,
              outlineColor: 'color-mix(in srgb, var(--lm-accent) 40%, transparent)',
            }
          : { hoverStyle: { backgroundColor: 'var(--lm-panel2)' } })}
        paddingLeft={`${depth * 14 + 8}px`}
      >
        {childIds.length > 0 ? (
          <Prim.Pressable
            onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
            color="var(--lm-muted)" width="$3" textAlign="center" flexShrink={0}
            aria-label={expanded ? 'collapse' : 'expand'}
          >
            {expanded ? '▾' : '▸'}
          </Prim.Pressable>
        ) : (
          <Prim.Text width="$3" flexShrink={0} />
        )}
        <StatusIcon status={node.status} />
        <Prim.Text color="var(--lm-text)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={node.label}>{node.label}</Prim.Text>
        <KindBadge kind={node.kind} />
        {dur && <Prim.Text color="var(--lm-muted)" fontSize="10px" fontFamily="$mono" flexShrink={0} marginLeft="auto">{dur}</Prim.Text>}
        {retries > 0 && <Prim.Text color="var(--lm-amber)" fontSize="10px" fontFamily="$mono" flexShrink={0} title={`${retries} retries`}>×{retries}</Prim.Text>}
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
    <Prim.Box as="nav" aria-label="execution tree" height="100%" overflowY="auto" paddingVertical="$1">
      <Prim.Row color="var(--lm-muted)" paddingHorizontal="$2" paddingVertical="$1" fontSize="10px" textTransform="uppercase" letterSpacing="$wider" justifyContent="space-between" alignItems="center">
        <Prim.Text>Execution</Prim.Text>
        {queue && <Prim.Text fontFamily="$mono">q {queue.active}/{queue.max}</Prim.Text>}
      </Prim.Row>
      {rootId ? <TreeRowById id={rootId} depth={0} now={now} /> : (
        <Prim.Box color="var(--lm-muted)" paddingHorizontal="$3" paddingVertical="$4" fontSize="12px">No activity yet. Send a message to start.</Prim.Box>
      )}
    </Prim.Box>
  );
}
