import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import { currentWorkSentence } from './node-meta';

/**
 * The chat's ONE live status line: a single sentence, directly above the message
 * input, saying what is being done right now.
 *
 * It sits there rather than under the conversation title because that is where the
 * reader already is. The title is a header — glanced at once when the chat opens and
 * then never again, while the eye stays between the newest message and the box it is
 * about to type in. A sentence that changes every few seconds twenty lines above that
 * is a sentence nobody reads, and on a phone the header can be scrolled past entirely.
 * Anchored to the composer it is in the same place the answer will appear.
 *
 * It replaces the old delegation tree (`LiveActivity` + `WorkBlock`), which
 * listed every in-flight fork/delegate/tasklist/task as an indented, expandable
 * row above the composer. On a phone that was a scrolling wall of rows competing
 * with the transcript for the little screen there is, and none of it was
 * actionable — the row's affordances (expand, open in inspector) lead to the
 * DevPanel, which is desktop-only (⌥I). The execution tree still exists in full
 * in the model and in the DevPanel's `ExecutionTree`; only the in-chat rendering
 * of it is one sentence now.
 *
 * A running sub-agent's narration wins over THING's own `setActivity` line:
 * while a delegate runs, THING is suspended and its last line is stale, so the
 * sub-agent is the fresher answer to "what is happening?". This reads the
 * execution tree (`model.nodes`) directly and writes nothing to `model.blocks`,
 * so the transcript is left untouched.
 */
export function StatusLine(): React.ReactElement | null {
  // `feedLive` mutates `model` in place without changing its reference; key the
  // re-render off `version` (the per-batch bump). Same pattern as the inspector.
  useStore((s) => s.version);
  const model = useStore((s) => s.model);
  const sessionActivity = useStore((s) => s.activity);

  const text = currentWorkSentence(model) || sessionActivity;
  if (!text) return null;

  return (
    <Prim.Row
      // Aligned with the composer below it, which owns the same `$4` horizontal padding.
      paddingHorizontal="$4" paddingTop="$2" gap="$1.5" fontSize="$xs" color="$muted-foreground" alignItems="center" minWidth={0} lineHeight="1rem"
      aria-live="polite"
      data-testid="activity"
      title={text}
    >
      {/* `Prim.Row` is an RN `View` — its `fontSize`/`color` above never reach these two `Prim.Text`
          children, so both restate them (see `primitives/_native.tsx#NativeText`'s unconditional
          `$body`/`$foreground` defaults). */}
      <Prim.Text className="animate-pulse" width="$1.5" height="$1.5" borderRadius="$radius-full" backgroundColor="$agent" flexShrink={0} fontSize="$xs" color="$muted-foreground" aria-hidden />
      <Prim.Text fontStyle="italic" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" fontSize="$xs" color="$muted-foreground">{text}</Prim.Text>
    </Prim.Row>
  );
}
