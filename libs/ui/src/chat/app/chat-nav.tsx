import React from 'react';
import { useStore } from '../store/store';

/**
 * Where the chat surface IS — which project, and which conversation inside it.
 *
 * Both fields are nullable because both nulls are real states a user can sit in, not
 * loading artefacts: "no project resolved yet" and "no conversation open" each have their own
 * screen, and on web their own URL (`/chat` and `/chat/<project>`).
 *
 * This is the whole of the surface's navigable state. Everything else the URL carries
 * (`?node=&tab=&follow=`) is a view of the OPEN conversation and belongs to `url-state.ts`;
 * it is deliberately not modelled here, because it does not survive a conversation switch.
 */
export interface ChatLocation {
  projectId: string | null;
  sessionId: string | null;
}

/**
 * A host that owns the location — on web, the router.
 *
 * `@lmthing/ui` cannot import a router: the same `ChatShell` mounts inside TanStack Router on web,
 * inside a plain hidden/shown pane on desktop, and inside a React Native app that has no history
 * stack at all. So the surface asks for the two things a router provides — where am I, and take me
 * there — and the host supplies them.
 *
 * `replace` is not decoration. It is the difference between a back button that works and one that
 * traps: a navigation the USER asked for pushes, and a correction the APP made on their behalf
 * (resolving `/chat` to a default project, leaving a conversation that was just deleted) replaces,
 * so pressing Back never lands them on the state the app just decided was wrong.
 */
export interface ChatNavHost {
  location: ChatLocation;
  navigate: (to: ChatLocation, opts: { replace: boolean }) => void;
}

const ChatNavContext = React.createContext<ChatNavHost | null>(null);

export function ChatNavProvider({
  host,
  children,
}: {
  host: ChatNavHost | null;
  children: React.ReactNode;
}): React.ReactElement {
  return <ChatNavContext.Provider value={host}>{children}</ChatNavContext.Provider>;
}

/** The navigation verbs the chat surface actually performs, plus where it currently is. */
export interface ChatNav extends ChatLocation {
  /** Open a project, closing any conversation. A user action → pushes a history entry. */
  openProject: (projectId: string) => void;
  /** Open a conversation. A user action → pushes a history entry. */
  openSession: (projectId: string, sessionId: string) => void;
  /**
   * Leave the open conversation. REPLACES, because the only callers are "the thing this URL names
   * is gone" (it was just deleted) — pushing would leave a back entry pointing at a dead id.
   */
  closeSession: () => void;
  /** A correction the app made on the user's behalf. Always replaces — see {@link ChatNavHost}. */
  redirect: (to: ChatLocation) => void;
}

/**
 * The location + the verbs, whether or not a host is wired.
 *
 * With no host (desktop, mobile, the Metro suites) the store IS the location: `openSession` sets
 * `activeSessionId` and the shell's session effect reacts to it exactly as it reacts to a URL
 * change on web. That is what keeps this one code path — there is no "routed" and "unrouted"
 * variant of opening a chat, only a different place the answer is written down.
 */
export function useChatNav(): ChatNav {
  const host = React.useContext(ChatNavContext);
  // Both selectors run unconditionally and one of them is ignored. Subscribing to a field we may
  // not read is cheaper than the alternative — a conditional hook, which React forbids outright.
  const storeProjectId = useStore((s) => s.activeProjectId);
  const storeSessionId = useStore((s) => s.activeSessionId);

  const projectId = host ? host.location.projectId : storeProjectId;
  const sessionId = host ? host.location.sessionId : storeSessionId;

  return React.useMemo<ChatNav>(() => {
    const go = (to: ChatLocation, replace: boolean): void => {
      if (host) {
        host.navigate(to, { replace });
        return;
      }
      const st = useStore.getState();
      st.setActiveProjectId(to.projectId);
      st.setActiveSessionId(to.sessionId);
    };
    return {
      projectId,
      sessionId,
      openProject: (id) => go({ projectId: id, sessionId: null }, false),
      openSession: (p, s) => go({ projectId: p, sessionId: s }, false),
      closeSession: () => go({ projectId, sessionId: null }, true),
      redirect: (to) => go(to, true),
    };
  }, [host, projectId, sessionId]);
}
