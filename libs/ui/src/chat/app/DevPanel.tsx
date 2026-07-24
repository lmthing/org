import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { useStore } from '../store/store.js';
import { ExecutionTree } from './tree.js';
import { Inspector } from './inspector.js';
import { PlaybackBar } from './replay.js';
import { cn } from '../lib/cn.js';

interface DevPanelProps {
  onClose: () => void;
  className?: string;
}

function Resizer({ onDrag }: { onDrag: (dx: number) => void }) {
  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev: MouseEvent) => { onDrag(ev.clientX - last); last = ev.clientX; };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <Prim.Box
      onMouseDown={down}
      className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-agent/40 transition-colors"
    />
  );
}

export function DevPanel({ onClose, className }: DevPanelProps) {
  const mode = useStore(s => s.mode);
  const [width, setWidth] = React.useState(380);
  const [treeH, setTreeH] = React.useState(240);

  return (
    <Prim.Box as="aside"
      aria-label="developer tools"
      display="flex"
      className={cn("bg-lm-panel border-lm-border", className)} position="relative" flexDirection="column" borderLeftWidth={1} overflow="hidden" flexShrink={0}
      style={{ width }}
    >
      <Resizer onDrag={(dx) => setWidth(w => Math.max(280, Math.min(700, w - dx)))} />

      {/* Header */}
      <Prim.Row className="border-lm-border" gap="$2" paddingHorizontal="$3" paddingVertical="$2" borderBottomWidth={1} alignItems="center" flexShrink={0}>
        <Prim.Text className="text-lm-text" fontSize="$xs" fontWeight="$semibold" flexGrow={1} flexShrink={1} flexBasis="0%">DevTools</Prim.Text>
        <Prim.Pressable
          onClick={onClose}
          className="text-lm-muted hover:text-lm-text text-base leading-none"
          aria-label="Close DevPanel"
        >
          ×
        </Prim.Pressable>
      </Prim.Row>

      {/* Execution tree */}
      <Prim.Box overflow="hidden" flexShrink={0} style={{ height: treeH }}>
        <ExecutionTree />
      </Prim.Box>

      {/* Tree/inspector resizer */}
      <Prim.Box
        className="h-1 cursor-row-resize bg-lm-border hover:bg-lm-accent/40 shrink-0"
        onMouseDown={(e) => {
          e.preventDefault();
          let last = e.clientY;
          const move = (ev: MouseEvent) => { setTreeH(h => Math.max(80, Math.min(600, h + ev.clientY - last))); last = ev.clientY; };
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />

      {/* Inspector */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minHeight={0} overflow="hidden">
        <Inspector />
      </Prim.Box>

      {/* Replay bar */}
      {mode === 'replay' && (
        <Prim.Box className="border-lm-border" flexShrink={0} borderTopWidth={1}>
          <PlaybackBar />
        </Prim.Box>
      )}
    </Prim.Box>
  );
}
