/**
 * `<Chat>` — the page-droppable, self-floating agent chat widget of `@app/runtime`.
 *
 * A page renders `<Chat agent="space/agent" />` anywhere (typically once, in
 * `pages/_layout`) and gets a fixed-position launcher button in the bottom-right
 * corner; clicking it opens a panel (a full-screen sheet on narrow viewports,
 * a floating card on wider ones) holding the exact same connected-session chat
 * surface as `AgentChatPanel` (studio's embeddable panel): status bar,
 * **`@lmthing/ui` catalog descriptor renderer** (`DisplayBlock`/`AskBlock`/
 * `VariablesBlock` — the ONE place that renderer lives inside a page app; pages
 * are otherwise real React), and the message input. Both share the
 * `ReplChatView` component from `@lmthing/ui/chat`. `ask()` form answers
 * round-trip over the same socket, exactly as `/chat` does. `<Chat>` owns its
 * own open/closed chrome — callers never need to build a dock around it.
 *
 * It reuses the standard pod chat protocol wholesale:
 *   1. `POST /api/sessions` `{ spaceRef, projectId }`  →  `{ sessionId }`.
 *   2. `ReplChatView` opens `WS /api/ws?sessionId=<id>`, streams
 *      display/ask/variables/error blocks, and posts user messages + ask
 *      answers back to `/api/sessions/:id/*`.
 *
 * We create the session ourselves (not `ReplRpcClient.createSession`, which posts
 * the `{ spaceDir, agentSlug }` shape) because Phase 7A's endpoint takes
 * `{ spaceRef, projectId }` — but everything downstream (WS, stream decode,
 * ask/message round-trip, descriptor rendering) is reused verbatim from
 * `@lmthing/ui` so the protocol never drifts.
 *
 * Browser/JSX module — bundled by the pages build (excluded from cli tsc). Styled
 * with `@lmthing/css` design tokens only; no raw colors. Uses inline `style`
 * objects rather than Tailwind utility classes because the pages build's
 * Tailwind scanner only walks the *project's* `pages/components/lib` dirs plus
 * `@lmthing/ui` — not this package's own dist — so utility classes written here
 * would silently never be generated.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReplChatView, getAccessToken } from '@lmthing/ui/chat';

import { createChatSession, originBase, resolveProjectId } from './chat-protocol.js';

/**
 * Platform access token from the same-origin `@lmthing/auth` session (reused via
 * the `@lmthing/ui/chat` barrel — the identical reader the main chat UI uses). On
 * lmthing.app the app page shares localStorage with the launcher, so the OAuth
 * session (set at login) is readable here; the pod's `/api/*` proxy is JWT-gated
 * and 401s an unauthenticated fetch without it. `undefined` in local/no-auth
 * mode (direct pod) — then no token is needed.
 */
function platformAccessToken(): string | undefined {
  try {
    return getAccessToken();
  } catch {
    return undefined;
  }
}

const MOBILE_QUERY = '(max-width: 640px)';

/** True on narrow viewports, where the open panel becomes a full-screen sheet. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

// ── Component ────────────────────────────────────────────────────────────────

export interface ChatProps {
  /** The agent to talk to, as a `space/agent` ref (the `spaceRef`). */
  agent: string;
  /** Project scope; defaults to the `…/app/<project>` segment of the URL. */
  projectId?: string;
  /** CSS class for the outer element (the launcher button, or the open panel). */
  className?: string;
  /** Panel header label. Defaults to "Chat". */
  title?: string;
}

/**
 * `<Chat agent="space/agent" />` — drop-in floating agent chat for a page app.
 * Renders a launcher button; opens into a responsive panel on click.
 */
export function Chat({ agent, projectId, className, title }: ChatProps): React.ReactElement {
  const storageKey = `lmthing.chat.${agent}.open`;
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const startedOnceRef = useRef(false);
  const isMobile = useIsMobile();

  // Restore last open/closed state (per agent, so multiple `<Chat>` widgets on
  // one page don't fight over a single key). Client only.
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(storageKey) === '1');
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const toggle = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const startSession = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setSessionId(null);
    try {
      const pid = projectId ?? resolveProjectId(window.location.pathname);
      const sid = await createChatSession(agent, pid, originBase(), platformAccessToken());
      setSessionId(sid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      runningRef.current = false;
    }
  }, [agent, projectId]);

  // Create the session once on mount, whether or not the panel starts open —
  // so it's already connected the moment the user clicks the launcher.
  useEffect(() => {
    if (startedOnceRef.current) return;
    startedOnceRef.current = true;
    void startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        aria-label={title ?? 'Open chat'}
        className={className}
        style={styles.fab}
      >
        <ChatBubbleIcon />
      </button>
    );
  }

  let body: React.ReactNode;
  if (error) {
    body = (
      <div style={{ ...styles.body, ...styles.center }}>
        <p style={{ color: 'var(--destructive)', textAlign: 'center', marginBottom: 8 }}>
          Failed to start chat: {error}
        </p>
        <button
          onClick={() => {
            startedOnceRef.current = false;
            void startSession();
          }}
          style={styles.retryButton}
        >
          Retry
        </button>
      </div>
    );
  } else if (!sessionId) {
    body = (
      <div style={{ ...styles.body, ...styles.center }}>
        <span style={{ color: 'var(--muted-foreground)' }}>Starting agent session…</span>
      </div>
    );
  } else {
    // Same token for the WS (`&access_token=`) and the `/api/sessions/:id/*` HTTP
    // sub-routes — both flow through the JWT-gated `/api/*` proxy on the platform.
    body = (
      <ReplChatView
        baseUrl={originBase()}
        sessionId={sessionId}
        accessToken={platformAccessToken()}
        style={styles.body}
        onRestart={() => {
          startedOnceRef.current = false;
          void startSession();
        }}
        restartDisabled={runningRef.current}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-label={title ?? 'Chat'}
      className={className}
      style={isMobile ? styles.panelMobile : styles.panelDesktop}
    >
      <div style={styles.header}>
        <span style={styles.headerTitle}>{title ?? 'Chat'}</span>
        <button type="button" onClick={() => toggle(false)} aria-label="Close chat" style={styles.closeButton}>
          <CloseIcon />
        </button>
      </div>
      {body}
    </div>
  );
}

// ── Icons (inline SVG — no icon package dependency) ──────────────────────────

function ChatBubbleIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
      />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ── Styles (design tokens only — no raw colors) ──────────────────────────────

const styles = {
  fab: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    borderRadius: 9999,
    border: 'none',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    boxShadow: '0 8px 24px color-mix(in srgb, var(--foreground) 25%, transparent)',
    cursor: 'pointer',
  } as React.CSSProperties,
  panelDesktop: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 40,
    display: 'flex',
    flexDirection: 'column' as const,
    width: 384,
    height: 'min(34rem, 80vh)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: 'var(--card)',
    boxShadow: '0 16px 48px color-mix(in srgb, var(--foreground) 30%, transparent)',
    overflow: 'hidden',
  } as React.CSSProperties,
  panelMobile: {
    position: 'fixed',
    inset: 0,
    zIndex: 40,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--card)',
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--background)',
  } as React.CSSProperties,
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--foreground)',
  } as React.CSSProperties,
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    border: 'none',
    background: 'transparent',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
  } as React.CSSProperties,
  body: {
    flex: 1,
    minHeight: 0,
  } as React.CSSProperties,
  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: 16,
  } as React.CSSProperties,
  retryButton: {
    padding: '0 16px',
    height: 32,
    borderRadius: 4,
    border: 'none',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    fontWeight: 500,
    cursor: 'pointer',
    alignSelf: 'center',
  } as React.CSSProperties,
};
