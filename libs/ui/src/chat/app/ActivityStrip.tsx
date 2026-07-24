import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../lib/cn.js';
import { useStore } from '../store/store.js';
import { KIND_ICON, STATUS_COLOR, fmtDuration } from './node-meta.js';

interface ActivityStripProps {
  nodeIds?: string[];
  className?: string;
}

export function ActivityStrip({ nodeIds, className }: ActivityStripProps) {
  const nodes = useStore((s) => s.model.nodes);
  const selectNode = useStore((s) => s.selectNode);
  const setDevPanelOpen = useStore((s) => s.setDevPanelOpen);
  const [expanded, setExpanded] = React.useState(false);

  const chips = (nodeIds ?? [])
    .map((id) => nodes[id])
    .filter((n) => n && n.kind !== 'session' && n.kind !== 'run');

  if (chips.length === 0) return null;

  const visible = expanded ? chips : chips.slice(0, 3);
  const hidden = chips.length - 3;

  const handleChip = (nodeId: string) => {
    selectNode(nodeId, true);
    setDevPanelOpen(true);
  };

  return (
    <Prim.Box display="flex" marginTop="0.5rem" className={className} flexWrap="wrap" alignItems="center" gap="$1.5">
      {visible.map((node) => {
        if (!node) return null;
        const dur = node.endTs && node.startTs ? fmtDuration(node.endTs - node.startTs) : null;
        return (
          <Prim.Pressable
            key={node.id}
            onClick={() => handleChip(node.id)}
            data-node-id={node.id}
            display="inline-flex"
            className={cn(
              'items-center gap-1 px-2 py-0.5 rounded-full border text-xs transition-all hover:opacity-80',
              STATUS_COLOR[node.status] ?? STATUS_COLOR.done,
            )}
          >
            <Prim.Text>{KIND_ICON[node.kind] ?? '◦'}</Prim.Text>
            <Prim.Text maxWidth="120px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{node.label}</Prim.Text>
            {node.status === 'running' && <Prim.Text className="lm-pulse">…</Prim.Text>}
            {dur && <Prim.Text opacity={0.6}>{dur}</Prim.Text>}
          </Prim.Pressable>
        );
      })}
      {!expanded && hidden > 0 && (
        <Prim.Pressable
          onClick={() => setExpanded(true)}
          fontSize="$xs" color="$muted-foreground" paddingHorizontal="$2" paddingVertical="$0.5" borderRadius="$radius-full" borderWidth={1} borderColor="$border" hoverStyle={{ color: "$foreground" }}
        >
          +{hidden} more
        </Prim.Pressable>
      )}
    </Prim.Box>
  );
}
