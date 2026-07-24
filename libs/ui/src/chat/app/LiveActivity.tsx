import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { useStore } from '../store/store.js';
import { selectActiveWork } from './node-meta.js';
import { WorkBlock } from './WorkBlock.js';

/**
 * Ephemeral, non-persistent status box pinned at the bottom of the chat. It
 * lists every in-flight sub-agent (delegate/fork/tasklist/task) with its live
 * narration, and disappears the moment nothing is running. It reads the
 * execution tree (`model.nodes`) directly and writes nothing to `model.blocks`,
 * so the transcript is left untouched — unlike the model's user/display/ask
 * blocks, this box never becomes part of the conversation history.
 */
export function LiveActivity(): React.ReactElement | null {
  // `feedLive` mutates `model` in place without changing its reference; key the
  // re-render off `version` (the per-batch bump). Same pattern as the inspector.
  useStore((s) => s.version);
  const model = useStore((s) => s.model);

  const active = selectActiveWork(model);
  if (active.length === 0) return null;

  return (
    <Prim.Box
      className="rounded-lg border border-border bg-muted/30 lm-fade-in" marginBottom="0.5rem" marginHorizontal="1rem"
      data-testid="live-activity"
      aria-label="sub-agent activity"
    >
      <Prim.Row gap="$1.5" borderColor="$border" paddingHorizontal="$3" paddingVertical="$1.5" fontSize="$xs" color="$muted-foreground" alignItems="center" style={{ lineHeight: '1rem' }}>
        <Prim.Text className="lm-pulse text-brand-2">●</Prim.Text>
        <Prim.Text>working…</Prim.Text>
        <Prim.Text opacity={0.6}>{active.length} active</Prim.Text>
      </Prim.Row>
      {/* Bounded, internally-scrollable list so a large parallel tasklist can't
          push the composer off-screen. */}
      <Prim.Box maxHeight="40vh" overflowY="auto" paddingVertical="$1">
        {active.map((n) => (
          <WorkBlock key={n.id} nodeId={n.id} />
        ))}
      </Prim.Box>
    </Prim.Box>
  );
}
