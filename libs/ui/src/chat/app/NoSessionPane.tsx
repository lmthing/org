import React from 'react';
import * as Prim from '../../elements/primitives/index';
import { useStore } from '../store/store';
import { startSession } from './session-control';

interface NoSessionPaneProps {
  /** The project a new chat would be created in; `null` when none is selected yet. */
  activeProjectId: string | null;
  /**
   * True when the sidebar is an overlay drawer rather than a docked column — i.e. it is NOT on
   * screen next to this pane. Drives whether we can talk about "the sidebar" at all.
   */
  sidebarIsDrawer: boolean;
}

/**
 * What the chat surface shows when no conversation is open.
 *
 * This used to be one sentence — "Select or start a chat from the sidebar." — and on web that is
 * true: the sidebar is a docked column right beside it. On a phone the sidebar is an overlay
 * drawer, so the sentence pointed at something that was not on screen and the pane offered nothing
 * to press. Closing the drawer left a blank screen with a single instruction that could not be
 * followed, which reads exactly like a broken app.
 *
 * So the pane carries the actions instead of describing them. `+ New chat` is the same call the
 * sidebar's button makes (see {@link startSession}); the drawer opener only appears where the
 * drawer exists, because on web the sidebar is already visible and a button to reveal it would be
 * a second control for a thing that is not hidden.
 */
export function NoSessionPane({ activeProjectId, sidebarIsDrawer }: NoSessionPaneProps) {
  const setSidebarOpen = useStore(s => s.setSidebarOpen);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  /**
   * The catch is load-bearing, not defensive habit. `startSession` throws on any non-2xx, and a
   * pod that has scaled to zero answers 503 for the ~20s it takes to wake — so the press that is
   * MOST likely to fail is the first one after opening the app. Without this the rejection
   * escaped an event handler as an unhandled promise, which on a device is a red `Uncaught (in
   * promise)` box over the whole screen and on web is a silent no-op button. Neither tells the
   * user the one useful thing: try again in a moment. (Caught by `metro/suites/chat-shell.tsx`,
   * where a real press against no gateway took the bundle down.)
   */
  const onNewChat = async () => {
    if (!activeProjectId || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await startSession(activeProjectId);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Prim.Col
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
      paddingHorizontal="$6"
      gap="$4"
    >
      <Prim.Text fontSize="$sm" color="$muted-foreground" textAlign="center">
        {activeProjectId
          ? 'No conversation open.'
          : 'Select or create a project to get started.'}
      </Prim.Text>

      {activeProjectId && (
        <Prim.Pressable
          onClick={() => void onNewChat()}
          disabled={busy}
          display="flex"
          alignItems="center"
          justifyContent="center"
          paddingHorizontal="$4"
          paddingVertical="$2"
          borderRadius="$radius-xl"
          borderWidth={0}
          backgroundColor="$primary"
          // On the PRESSABLE as well as on the label. A native `Text` does not inherit colour
          // through a `View`, so the label alone is enough on web and comes out in the default
          // foreground on a device — dark type on the primary fill, which is the one combination
          // the token pair exists to prevent. The sidebar's own New chat button sets it here.
          color="$primary-foreground"
          hoverStyle={{ opacity: 0.9 }}
          disabledStyle={{ opacity: 0.5 }}
        >
          <Prim.Text color="$primary-foreground" fontSize="$sm" fontWeight="$medium">
            {busy ? '…' : '+ New chat'}
          </Prim.Text>
        </Prim.Pressable>
      )}

      {sidebarIsDrawer && (
        <Prim.Pressable
          onClick={() => setSidebarOpen(true)}
          display="flex"
          alignItems="center"
          justifyContent="center"
          paddingHorizontal="$4"
          paddingVertical="$2"
          borderRadius="$radius-xl"
          borderWidth={1}
          borderColor="$border"
          hoverStyle={{ backgroundColor: '$muted' }}
        >
          <Prim.Text color="$foreground" fontSize="$sm">
            Your conversations
          </Prim.Text>
        </Prim.Pressable>
      )}
    </Prim.Col>
  );
}
