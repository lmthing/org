import React from 'react';
import { cn } from '../lib/cn.js';
import { useStore } from '../store/store.js';

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const KIND_ICON: Record<string, string> = {
  run: '⟳', fork: '⑂', delegate: '⤷', tasklist: '☰', session: '◉',
};

const STATUS_COLOR: Record<string, string> = {
  running: 'text-brand-2 bg-brand-2/10 border-brand-2/30',
  done: 'text-muted-foreground bg-muted border-border',
  error: 'text-destructive bg-destructive/10 border-destructive/30',
  pending: 'text-muted-foreground bg-muted border-border',
};

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
    <div className={cn('flex flex-wrap items-center gap-1.5 mt-2', className)}>
      {visible.map((node) => {
        if (!node) return null;
        const dur = node.endTs && node.startTs ? fmtDuration(node.endTs - node.startTs) : null;
        return (
          <button
            key={node.id}
            onClick={() => handleChip(node.id)}
            data-node-id={node.id}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs transition-all hover:opacity-80',
              STATUS_COLOR[node.status] ?? STATUS_COLOR.done,
            )}
          >
            <span>{KIND_ICON[node.kind] ?? '◦'}</span>
            <span className="max-w-[120px] truncate">{node.label}</span>
            {node.status === 'running' && <span className="lm-pulse">…</span>}
            {dur && <span className="opacity-60">{dur}</span>}
          </button>
        );
      })}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded-full border border-border"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}
