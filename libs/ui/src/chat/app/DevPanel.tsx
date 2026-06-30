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
    <div
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
    <aside
      aria-label="developer tools"
      className={cn(
        'relative flex flex-col bg-lm-panel border-l border-lm-border overflow-hidden shrink-0',
        className,
      )}
      style={{ width }}
    >
      <Resizer onDrag={(dx) => setWidth(w => Math.max(280, Math.min(700, w - dx)))} />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-lm-border shrink-0">
        <span className="text-xs font-semibold text-lm-text flex-1">DevTools</span>
        <button
          onClick={onClose}
          className="text-lm-muted hover:text-lm-text text-base leading-none"
          aria-label="Close DevPanel"
        >
          ×
        </button>
      </div>

      {/* Execution tree */}
      <div className="overflow-hidden shrink-0" style={{ height: treeH }}>
        <ExecutionTree />
      </div>

      {/* Tree/inspector resizer */}
      <div
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
      <div className="flex-1 min-h-0 overflow-hidden">
        <Inspector />
      </div>

      {/* Replay bar */}
      {mode === 'replay' && (
        <div className="shrink-0 border-t border-lm-border">
          <PlaybackBar />
        </div>
      )}
    </aside>
  );
}
