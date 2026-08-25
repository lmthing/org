import React from 'react';
import * as Prim from '../../elements/primitives/index';
import type { AppSurfaceState } from './use-app-pages';

/**
 * The one-time "your chat just became an app" coach-mark.
 *
 * The single jarring moment in the chat-first lifecycle is the demotion: the first real page lands,
 * the full-screen chat collapses into the floating dock, and — without a word — the user can think
 * "where did my conversation go?". This fires exactly once per project, the first time its surface
 * transitions `newborn → app`, to name what happened: the assistant now lives in the dock, and
 * talking to it keeps building. It never fires on a project that was already an app when opened
 * (we must have SEEN it newborn first), and never twice (a per-project `localStorage` flag).
 *
 * The entrance uses `.lm-fade-in`, which `@lmthing/css/animations.css` already collapses to no
 * animation under `prefers-reduced-motion` — so honoring the user's motion preference is free.
 */

const FLAG_PREFIX = 'lmthing_coachmark_newborn_app_';

function flagKey(projectId: string): string {
  return `${FLAG_PREFIX}${projectId}`;
}

/** Has this project's coach-mark already been shown (and dismissed/auto-marked)? Storage-safe. */
function alreadyShown(projectId: string): boolean {
  try {
    return localStorage.getItem(flagKey(projectId)) !== null;
  } catch {
    // Private mode / storage disabled: treat as "not shown" so the hint still appears once this
    // session, and simply don't persist. Better a repeat than a silent transition.
    return false;
  }
}

function markShown(projectId: string): void {
  try {
    localStorage.setItem(flagKey(projectId), '1');
  } catch {
    // Non-persistent is acceptable — see alreadyShown.
  }
}

/**
 * Tracks the `newborn → app` transition for the active project and yields whether the coach-mark
 * should be visible, plus a `dismiss`. Returns `{ show:false }` until a project observed newborn
 * grows a real page, and only for the first such project-transition ever (per `localStorage`).
 */
export function useNewbornToAppCoachMark(
  projectId: string | null,
  state: AppSurfaceState,
): { show: boolean; dismiss: () => void } {
  const [show, setShow] = React.useState(false);
  // The last state we saw for the CURRENT project — the transition is a change in THIS ref, not a
  // first observation. Reset whenever the project changes so switching projects can't cross-fire.
  const prev = React.useRef<{ projectId: string | null; state: AppSurfaceState | null }>({
    projectId: null,
    state: null,
  });

  React.useEffect(() => {
    const last = prev.current;
    const sameProject = last.projectId === projectId;
    const wasNewborn = sameProject && last.state === 'newborn';
    prev.current = { projectId, state };

    if (projectId && wasNewborn && state === 'app' && !alreadyShown(projectId)) {
      markShown(projectId);
      setShow(true);
    } else if (!sameProject) {
      // Switched projects — never leave a previous project's mark hanging over another.
      setShow(false);
    }
  }, [projectId, state]);

  const dismiss = React.useCallback(() => setShow(false), []);
  return { show, dismiss };
}

/**
 * The visible coach-mark card. Anchored bottom-right (where the dock now lives) so the eye is drawn
 * to where the chat went. Token-styled only; dismiss on tap.
 */
export function CoachMark({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  return (
    <Prim.Box
      className="lm-fade-in"
      position="fixed"
      bottom="$5"
      right="$5"
      maxWidth={320}
      zIndex={1700}
      backgroundColor="$popover"
      borderColor="$border"
      borderWidth={1}
      borderRadius="$radius-lg"
      padding="$4"
      gap="$2"
      role="status"
      aria-live="polite"
      shadowColor="$scrim"
      shadowOffset={{ width: 0, height: 10 }}
      shadowRadius={15}
    >
      <Prim.Text fontWeight="600" color="$popover-foreground">
        Your assistant lives here now
      </Prim.Text>
      <Prim.Text fontSize="$sm" color="$muted-foreground">
        Your chat moved into the dock in the corner. Keep talking to it to build more of your app.
      </Prim.Text>
      <Prim.Pressable
        onClick={onDismiss}
        alignSelf="flex-end"
        marginTop="$1"
        paddingVertical="$1"
        paddingHorizontal="$3"
        borderRadius="$radius"
        backgroundColor="$primary"
        aria-label="Dismiss"
      >
        <Prim.Text color="$primary-foreground" fontSize="$sm" fontWeight="500">
          Got it
        </Prim.Text>
      </Prim.Pressable>
    </Prim.Box>
  );
}
