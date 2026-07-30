import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import { ExecutionTree } from './tree';
import { Inspector } from './inspector';
import { PlaybackBar } from './replay';
import { cn } from '../lib/cn';

interface DevPanelProps {
  onClose: () => void;
  className?: string;
  /** Panel height. Callers used to pass `className="h-full"`, a Tailwind utility. */
  height?: number | string;
}

/**
 * Drag-to-resize, which is a MOUSE interaction and therefore web-only.
 *
 * Optional-chained off `globalThis.window` rather than put behind a seam: the DevPanel is opened
 * with Alt+I, a key combination that cannot be pressed on a phone, so this whole panel is
 * unreachable on native. A seam here would be inventing a native behaviour for something the user
 * can never reach. What matters is that it does not THROW if it is ever mounted.
 */
function Resizer({ onDrag }: { onDrag: (dx: number) => void }) {
  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev: MouseEvent) => { onDrag(ev.clientX - last); last = ev.clientX; };
    const up = () => { globalThis.window?.removeEventListener('mousemove', move); globalThis.window?.removeEventListener('mouseup', up); };
    globalThis.window?.addEventListener('mousemove', move);
    globalThis.window?.addEventListener('mouseup', up);
  };
  return (
    <Prim.Box
      onMouseDown={down}
      transition="quick" animateOnly={["color", "background-color", "border-color"]} position="absolute" left="$0" top="$0" bottom="$0" width="$1" cursor="col-resize" hoverStyle={{ backgroundColor: "color-mix(in srgb, var(--agent) 40%, transparent)" }}
    />
  );
}

export function DevPanel({ onClose, className, height }: DevPanelProps) {
  const mode = useStore(s => s.mode);
  const [width, setWidth] = React.useState(380);
  const [treeH, setTreeH] = React.useState(240);

  return (
    <Prim.Box as="aside"
      aria-label="developer tools"
      display="flex"
      className={className} {...(height !== undefined ? { height } : {})} backgroundColor="var(--lm-panel)" borderColor="var(--lm-border)" position="relative" flexDirection="column" borderLeftWidth={1} overflow="hidden" flexShrink={0}
      style={{ width }}
    >
      <Resizer onDrag={(dx) => setWidth(w => Math.max(280, Math.min(700, w - dx)))} />

      {/* Header */}
      <Prim.Row borderColor="var(--lm-border)" gap="$2" paddingHorizontal="$3" paddingVertical="$2" borderBottomWidth={1} alignItems="center" flexShrink={0}>
        <Prim.Text color="var(--lm-text)" fontSize="$xs" fontWeight="$semibold" flexGrow={1} flexShrink={1} flexBasis="0%">DevTools</Prim.Text>
        <Prim.Pressable
          onClick={onClose}
          color="var(--lm-muted)" fontSize="$base" lineHeight={16} hoverStyle={{ color: "var(--lm-text)" }}
          aria-label="Close DevPanel"
        >
          <Prim.Text>×</Prim.Text>
        </Prim.Pressable>
      </Prim.Row>

      {/* Execution tree */}
      <Prim.Box overflow="hidden" flexShrink={0} height={treeH}>
        <ExecutionTree />
      </Prim.Box>

      {/* Tree/inspector resizer */}
      <Prim.Box
        height="$1" cursor="row-resize" backgroundColor="var(--lm-border)" flexShrink={0} hoverStyle={{ backgroundColor: "color-mix(in srgb, var(--lm-accent) 40%, transparent)" }}
        onMouseDown={(e) => {
          e.preventDefault();
          let last = e.clientY;
          const move = (ev: MouseEvent) => { setTreeH(h => Math.max(80, Math.min(600, h + ev.clientY - last))); last = ev.clientY; };
          const up = () => { globalThis.window?.removeEventListener('mousemove', move); globalThis.window?.removeEventListener('mouseup', up); };
          globalThis.window?.addEventListener('mousemove', move);
          globalThis.window?.addEventListener('mouseup', up);
        }}
      />

      {/* Inspector */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minHeight={0} overflow="hidden">
        <Inspector />
      </Prim.Box>

      {/* Replay bar */}
      {mode === 'replay' && (
        <Prim.Box borderColor="var(--lm-border)" flexShrink={0} borderTopWidth={1}>
          <PlaybackBar />
        </Prim.Box>
      )}
    </Prim.Box>
  );
}
