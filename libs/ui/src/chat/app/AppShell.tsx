import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import { ChatView } from './ChatView';
import { TopBar } from './TopBar';
import { NoSessionPane } from './NoSessionPane';
import { DevPanel } from './DevPanel';
import { ProjectSettings } from './ProjectSettings';
import { Drawer } from '../components/ui/Drawer';
import { getLiveSend } from './live-send';
import { readLinkParams } from '../../platform/deep-link';
import { getWindowSize, subscribeWindowSize } from '../../platform/dimensions';
import { setAppTitle } from '../../platform/navigation';
import { onKeyDown } from '../../platform/keyboard';
import { startSession } from './session-control';
import { useChatNav } from './chat-nav';
import type { Surface } from '../../elements/nav/surface-switcher';

/** Is `target` already an editable element? Guards the bare `/` shortcut below from hijacking a
 *  `/` the user meant to TYPE somewhere else (the composer itself, a text field inside a drawer,
 *  …). Reachable only from the web `/` handler (`onKeyDown` never fires on native — see
 *  `platform/keyboard.native.ts` — so the DOM types here are never evaluated on a phone). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

interface AppShellProps {
  singleSession?: boolean;
  /** Forwarded to the `TopBar`'s `SurfaceSwitcher` — see that component's doc comment. */
  onSwitchSurface?: (surface: Surface) => void;
  /** Forwarded to the `TopBar`'s `SurfaceSwitcher`. */
  surfaceBadges?: Partial<Record<Surface, number>>;
  /**
   * Replaces the transcript pane. `ChatShell` passes one while a project's chat is being resolved or
   * a conversation is opening (`OpeningPane`), or when the named project/conversation does not exist
   * (`MissingPane`) — see `RoutePanes.tsx`. It fills the pane below the top bar.
   */
  mainPane?: React.ReactNode;
}

export function AppShell({ singleSession, onSwitchSurface, surfaceBadges, mainPane }: AppShellProps) {
  const devPanelOpen = useStore(s => s.devPanelOpen);
  const setDevPanelOpen = useStore(s => s.setDevPanelOpen);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeSessionId = useStore(s => s.activeSessionId);
  const sessionTitle = useStore(s => s.sessionTitle);
  const mode = useStore(s => s.mode);
  const nav = useChatNav();
  const running = useStore(s => Object.values(s.model.nodes).filter(n => n.status === 'running').length);
  const done = useStore(s => s.done);
  const noteUser = useStore(s => s.noteUserMessage);

  // Post the resume nudge into the ACTIVE chat after an Integrations-tab save (the
  // pod has already been confirmed back by the tab). Show it in the transcript
  // (noteUser) AND hand it to the live session socket so THING continues. The tab
  // only calls this once the socket is open, so the send is never a silent drop.
  const onIntegrationConfigured = React.useCallback((_spaceId: string, message: string) => {
    noteUser(message);
    const send = getLiveSend();
    send?.({ type: 'sendMessage', content: message });
  }, [noteUser]);

  const [projectSettings, setProjectSettings] = React.useState<{ id: string; name: string } | null>(null);
  const [isTablet, setIsTablet] = React.useState(false);

  // Check for ?inspect=1 on load
  React.useEffect(() => {
    if (readLinkParams().inspect === '1') setDevPanelOpen(true);
  }, [setDevPanelOpen]);

  // Responsive breakpoint — the DevPanel docks ≥1024px and is a drawer below.
  React.useEffect(() => {
    const check = () => {
      const { width } = getWindowSize();
      setIsTablet(width < 1024);
    };
    check();
    return subscribeWindowSize(check);
  }, []);

  // Document title. Now that a conversation has a URL it also gets its own title: a tab, a
  // bookmark and a history entry are all labelled by this, and "THING" on every one of them makes
  // the browser's own history — the thing the back button walks — unreadable.
  React.useEffect(() => {
    const name = sessionTitle ? `${sessionTitle} · THING` : 'THING';
    setAppTitle(mode === 'replay'
      ? `⏵ replay · ${name}`
      : running > 0
      ? `⟳ ${running} running · ${name}`
      : done
      ? `✓ done · ${name}`
      : name);
  }, [running, done, mode, sessionTitle]);

  // Alt+I shortcut — developer-only (toggles DevTools), left as-is.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'i') { e.preventDefault(); setDevPanelOpen(!devPanelOpen); }
    };
    return onKeyDown(onKey);
  }, [devPanelOpen, setDevPanelOpen]);

  // The two shortcuts an everyday reader actually wants, as opposed to Alt+I above. Both no-op on
  // native without any extra guard: `onKeyDown` (`platform/keyboard`) is a documented no-op there
  // (no hardware keyboard — see `keyboard.native.ts`), which is also why this needs no `isWeb`
  // check of its own to keep the native build from touching `document`.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // New chat — Alt+N. Shares `Alt+I`'s modifier rather than `Ctrl`/`Cmd`+N, which every
      // browser reserves for a new WINDOW and refuses to hand a page. Only meaningful where
      // there is a project to hold the new session (the `singleSession` embeddings — a studio
      // panel, say — have no session list for a fresh one to join).
      if (e.altKey && e.key.toLowerCase() === 'n') {
        if (!singleSession && activeProjectId) {
          e.preventDefault();
          // Navigate to it as well as create it — a new chat is a place you can come Back from.
          void startSession(activeProjectId).then(id => nav.openSession(activeProjectId, id));
        }
        return;
      }
      // Focus the composer — bare `/`, the convention GitHub/Slack/Discord/Notion all use for
      // "jump to the primary input". Left alone whenever it would otherwise TYPE a `/` into
      // something already focused (the composer itself included).
      if (e.key === '/' && !isEditableTarget(e.target)) {
        const field = globalThis.document?.querySelector<HTMLTextAreaElement>('[data-testid="message-input"]');
        if (field) { e.preventDefault(); field.focus(); }
      }
    };
    return onKeyDown(onKey);
  }, [singleSession, activeProjectId, nav]);

  const showTopBar = !singleSession;
  const showDevPanel = devPanelOpen;
  // On tablet, devpanel is always a drawer
  const devPanelAsDrawer = isTablet;

  return (
    <Prim.Col height="100%" overflow="hidden" backgroundColor="$background">
      {/* Top bar — project switcher + surface switcher. Replaces the old left sidebar. */}
      {showTopBar && (
        <TopBar
          onProjectSettings={(id, name) => setProjectSettings({ id, name })}
          onSwitchSurface={onSwitchSurface}
          surfaceBadges={surfaceBadges}
        />
      )}

      <Prim.Row flexGrow={1} flexShrink={1} flexBasis="0%" minHeight={0} overflow="hidden">
        {/* Main: a routed pane (opening / not-found), the no-session pane, or the transcript. */}
        <Prim.Col position="relative" overflow="hidden" flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
          {mainPane ? (
            mainPane
          ) : showTopBar && !activeSessionId ? (
            <NoSessionPane activeProjectId={activeProjectId} sidebarIsDrawer={false} />
          ) : (
            <ChatView
              onOpenDevPanel={() => setDevPanelOpen(!devPanelOpen)}
              devPanelOpen={devPanelOpen}
              projectId={activeProjectId}
              singleSession={singleSession}
              flexGrow={1}
              flexShrink={1}
              flexBasis="0%"
              minHeight={0}
            />
          )}
        </Prim.Col>

        {/* DevPanel — docked on desktop, drawer on tablet */}
        {showDevPanel && !devPanelAsDrawer && (
          <DevPanel onClose={() => setDevPanelOpen(false)} height="100%" />
        )}
        {showDevPanel && devPanelAsDrawer && (
          <Drawer
            open={devPanelOpen}
            onClose={() => setDevPanelOpen(false)}
            side="right"
            width="$96"
            title="DevTools"
          >
            <DevPanel onClose={() => setDevPanelOpen(false)} height="100%" />
          </Drawer>
        )}
      </Prim.Row>

      {/* Project settings drawer */}
      {projectSettings && (
        <ProjectSettings
          open={true}
          onClose={() => setProjectSettings(null)}
          projectId={projectSettings.id}
          projectName={projectSettings.name}
          onIntegrationConfigured={onIntegrationConfigured}
        />
      )}
    </Prim.Col>
  );
}
