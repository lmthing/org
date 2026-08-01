import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { cn } from '../lib/cn';
import { useStore } from '../store/store';
import { KIND_ICON, STATUS_COLOR, fmtDuration } from './node-meta';

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
        const chip = STATUS_COLOR[node.status] ?? STATUS_COLOR.done;
        // The STATUS colour and the chip's size live on the `Pressable`, which is an RN `View` — it
        // has no text style for these four leaves to inherit, so every one of them restates the pair.
        // Without it a `running` chip's label came out `$foreground` at the body size on a phone
        // instead of `$brand-2` at `$xs`: legible, so no gate and no glance catches it, and the whole
        // point of a status chip is that its colour IS the status.
        const face = { fontSize: '$xs', color: chip?.['color'] } as const;
        return (
          <Prim.Pressable
            key={node.id}
            onClick={() => handleChip(node.id)}
            data-node-id={node.id}
            display="inline-flex"
            {...chip} transition="quick" alignItems="center" gap="$1" paddingHorizontal="$2" paddingVertical="$0.5" borderRadius="$radius-full" borderWidth={1} fontSize="$xs" hoverStyle={{ opacity: 0.8 }}
          >
            <Prim.Text {...face}>{KIND_ICON[node.kind] ?? '◦'}</Prim.Text>
            <Prim.Text {...face} maxWidth="120px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{node.label}</Prim.Text>
            {node.status === 'running' && <Prim.Text {...face} className="lm-pulse">…</Prim.Text>}
            {dur && <Prim.Text {...face} opacity={0.6}>{dur}</Prim.Text>}
          </Prim.Pressable>
        );
      })}
      {!expanded && hidden > 0 && (
        <Prim.Pressable
          onClick={() => setExpanded(true)}
          fontSize="$xs" color="$muted-foreground" paddingHorizontal="$2" paddingVertical="$0.5" borderRadius="$radius-full" borderWidth={1} borderColor="$border" hoverStyle={{ color: "$foreground" }}
        >
          {/* `Prim.Pressable` is an RN `View` — its `fontSize`/`color` above style the button, not
              this bare label, so both are restated on the wrapped `Prim.Text` directly (see
              `primitives/_native.tsx#NativeText`'s unconditional `$body`/`$foreground` defaults). */}
          <Prim.Text fontSize="$xs" color="$muted-foreground">+{hidden} more</Prim.Text>
        </Prim.Pressable>
      )}
    </Prim.Box>
  );
}
