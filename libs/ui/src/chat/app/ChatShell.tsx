import React, { useEffect } from 'react';
import { useStore, type Project } from '../store/store';
import { authHeaders } from './auth';
import { apiUrl } from '../../platform/api-base';
import { AppShell } from './AppShell';
import { applyUrlToState, syncStateToUrl } from './url-state';
import { ChatNavProvider, useChatNav, type ChatLocation, type ChatNavHost } from './chat-nav';
import { closeActiveSession, getConnectedSessionId, openSession, startSession } from './session-control';
import { MissingPane, OpeningPane } from './RoutePanes';
import { AppFrame } from './AppView';
import { isNotFound } from './api';
import type { Surface } from '../../elements/nav/surface-switcher';

interface ChatShellProps {
  /**
   * The project the location names, from the host's router. Omit (or `null`) to have the shell
   * resolve a default and navigate to it.
   */
  projectId?: string | null;
  /** The conversation the location names. `null`/omitted is the real "no conversation open" state. */
  sessionId?: string | null;
  /**
   * Supplied together with the two above by a host that owns a history stack (the web app). Without
   * it the shell keeps its own location in the store, which is what desktop and mobile want — see
   * `chat-nav.tsx`.
   */
  onNavigate?: (to: ChatLocation, opts: { replace: boolean }) => void;
  /** Forwarded to `AppShell` — see its doc comment. */
  onSwitchSurface?: (surface: Surface) => void;
  /** Forwarded to `AppShell`. */
  surfaceBadges?: Partial<Record<Surface, number>>;
  /**
   * Forwarded to `AppShell` → `Sidebar` → `AppSidebar`. A host that can render a project's app pages
   * NATIVELY (the mobile app) passes this so a tap on a sidebar app page opens the native renderer
   * instead of the pod's `/app/<project>/…` mount in a browser. Omitted on web — see `Sidebar`'s
   * `onOpenAppPage`.
   */
  onOpenAppPage?: (project: { id: string; name: string }, routePath: string) => void;
}

/**
 * The standalone agent-ui chat shell (sidebar + transcript + DevPanel), packaged as a component so
 * it can be rendered at the `/chat/...` routes of the unified web app.
 *
 * It is also the surface's ONE synchronisation point: the location is the source of truth, and the
 * three things that have to agree with it — the store's `activeProjectId`, the store's
 * `activeSessionId`, and the live WebSocket — are driven from it here, in that one direction. The
 * reverse (a click writing state and the URL trailing behind it) is what makes a back button
 * misbehave, so no other component in the surface sets those fields; they navigate instead.
 */
export function ChatShell({
  projectId = null,
  sessionId = null,
  onNavigate,
  onSwitchSurface,
  surfaceBadges,
  onOpenAppPage,
}: ChatShellProps = {}): React.ReactElement {
  const host = React.useMemo<ChatNavHost | null>(
    () => (onNavigate ? { location: { projectId, sessionId }, navigate: onNavigate } : null),
    [projectId, sessionId, onNavigate],
  );
  return (
    <ChatNavProvider host={host}>
      <ChatShellBody onSwitchSurface={onSwitchSurface} surfaceBadges={surfaceBadges} onOpenAppPage={onOpenAppPage} />
    </ChatNavProvider>
  );
}

/**
 * Whether the conversation the location names could be opened. `gone` and `unavailable` are kept
 * apart on purpose: one is a fact about the conversation, the other about right now, and telling a
 * user their chat is deleted because the pod was waking up would be a lie they cannot check.
 */
type OpenState =
  | { status: 'idle' }
  | { status: 'opening' }
  | { status: 'gone' }
  | { status: 'unavailable' };

function ChatShellBody({
  onSwitchSurface,
  surfaceBadges,
  onOpenAppPage,
}: Pick<ChatShellProps, 'onSwitchSurface' | 'surfaceBadges' | 'onOpenAppPage'>): React.ReactElement {
  const nav = useChatNav();
  const projects = useStore((s) => s.projects);
  const [projectsLoaded, setProjectsLoaded] = React.useState(false);
  const [openState, setOpenState] = React.useState<OpenState>({ status: 'idle' });
  /** Bumped by the retry button — the only way to re-run the open effect at an unchanged location. */
  const [retry, setRetry] = React.useState(0);

  // ── Projects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // PodEnsureGate has already confirmed the pod's edge is serving before mounting us, so a
      // single fetch is safe here (no cold-wake race to retry around).
      try {
        const res = await fetch(apiUrl('/api/projects'), { headers: authHeaders() });
        if (res.ok) {
          const { projects: list } = (await res.json()) as { projects: Project[] };
          if (!cancelled) useStore.getState().setProjects(list);
        }
      } catch {
        // No project API available — shell renders with an empty sidebar.
      } finally {
        if (!cancelled) setProjectsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Deep-link view params (?node=&tab=&follow=) ────────────────────────────
  // Distinct from the location above: these describe a view of the OPEN conversation, and the
  // channel they live in differs per platform. See `url-state.ts`.
  useEffect(() => {
    applyUrlToState();
    return syncStateToUrl();
  }, []);

  // ── `/chat` with no project → the default one ──────────────────────────────
  // A REDIRECT, not a push: the user asked for "chat", and landing them on a project is the app
  // answering that question. A pushed entry here would make Back re-ask it and bounce forward again.
  useEffect(() => {
    if (nav.projectId || !projectsLoaded || projects.length === 0) return;
    const fallback = projects.find((p) => p.id === 'user') ?? projects[0];
    if (fallback) nav.redirect({ projectId: fallback.id, sessionId: null });
  }, [nav, projectsLoaded, projects]);

  // ── Location → store ───────────────────────────────────────────────────────
  // The rest of the surface reads `activeProjectId` (sidebar contents, the composer's target, the
  // bug reporter); this is the only thing that writes it.
  useEffect(() => {
    useStore.getState().setActiveProjectId(nav.projectId);
  }, [nav.projectId]);

  // ── Location → the live socket ─────────────────────────────────────────────
  // Every way of arriving at a conversation ends here: a sidebar click, a fresh chat, a pasted
  // link, a reload, Back, Forward. `openSession` is idempotent, so the re-runs this effect makes
  // on unrelated location changes cost nothing.
  useEffect(() => {
    const { projectId, sessionId } = nav;
    if (!sessionId) {
      if (getConnectedSessionId()) {
        closeActiveSession();
        // `resetSession` as well as closing the socket: the transcript, the selected node, the
        // running count and the conversation's title all belong to the chat being left. Without it
        // Back to `/chat/<project>` kept the old chat's name in the tab and its node id in the
        // query — a URL that named a node in a conversation that was no longer open.
        useStore.getState().resetSession();
        useStore.getState().setActiveSessionId(null);
      }
      setOpenState({ status: 'idle' });
      return;
    }
    if (getConnectedSessionId() === sessionId) {
      setOpenState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setOpenState({ status: 'opening' });
    void openSession(projectId, sessionId)
      .then(() => { if (!cancelled) setOpenState({ status: 'idle' }); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOpenState({ status: isNotFound(err) ? 'gone' : 'unavailable' });
      });
    return () => { cancelled = true; };
  }, [nav.projectId, nav.sessionId, retry]);

  // ── What the main pane shows when the location names something that isn't there ──
  const projectMissing =
    projectsLoaded && nav.projectId !== null && !projects.some((p) => p.id === nav.projectId);

  const newChatHere = React.useCallback(() => {
    const target = nav.projectId;
    if (!target) return;
    void startSession(target).then((id) => nav.openSession(target, id));
  }, [nav]);

  let mainPane: React.ReactNode = null;
  if (projectMissing) {
    const fallback = projects.find((p) => p.id === 'user') ?? projects[0];
    mainPane = (
      <MissingPane
        title="That project isn’t here"
        detail={`No project “${nav.projectId}” — it may have been deleted, or belong to another account.`}
        actions={
          fallback
            ? [{ label: `Open ${fallback.name}`, onPress: () => nav.openProject(fallback.id), primary: true }]
            : []
        }
      />
    );
  } else if (openState.status === 'opening') {
    mainPane = <OpeningPane />;
  } else if (openState.status === 'gone') {
    mainPane = (
      <MissingPane
        title="That conversation isn’t here"
        detail="It may have been deleted, or the link may belong to a different account."
        actions={[
          { label: '+ New chat', onPress: newChatHere, primary: true },
          { label: 'Your conversations', onPress: () => nav.closeSession() },
        ]}
      />
    );
  } else if (openState.status === 'unavailable') {
    // The conversation is fine — the pod is not, yet. Says the opposite of the pane above and
    // offers the one action that can actually change the answer.
    mainPane = (
      <MissingPane
        title="Couldn’t open that conversation"
        detail="Your workspace didn’t answer. It may still be waking up."
        actions={[
          { label: 'Try again', onPress: () => setRetry((n) => n + 1), primary: true },
          { label: 'Your conversations', onPress: () => nav.closeSession() },
        ]}
      />
    );
  } else if (nav.projectId && !nav.sessionId) {
    // A project is selected and no specific conversation is open: LOAD THE APP. Every project is a
    // served app from birth (a chat page that grows), so this is where "select a project and it
    // starts as a chat" happens — the app's own dock is the chat, front-and-centre while the project
    // is newborn and a floating modal once it has real pages. An explicit conversation URL still
    // opens the rich transcript (`ChatView`) below.
    mainPane = <AppFrame projectId={nav.projectId} title="App" />;
  }

  return (
    <AppShell
      onSwitchSurface={onSwitchSurface}
      surfaceBadges={surfaceBadges}
      onOpenAppPage={onOpenAppPage}
      mainPane={mainPane}
    />
  );
}
