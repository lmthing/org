/**
 * `<Chat>` — the page-droppable agent chat widget of `@app/runtime`.
 *
 * A page renders `<Chat agent="space/agent" />` and gets the exact same
 * connected-session chat surface as `AgentChatPanel` (studio's embeddable
 * panel): status bar, **`@lmthing/ui` catalog descriptor renderer**
 * (`DisplayBlock`/`AskBlock`/`VariablesBlock` — the ONE place that renderer
 * lives inside a page app; pages are otherwise real React), and the message
 * input. Both share the `ReplChatView` component from `@lmthing/ui/chat`.
 * `ask()` form answers round-trip over the same socket, exactly as `/chat` does.
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
 * with `@lmthing/css` design tokens only; no raw colors.
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

// ── Component ────────────────────────────────────────────────────────────────

export interface ChatProps {
  /** The agent to talk to, as a `space/agent` ref (the `spaceRef`). */
  agent: string;
  /** Project scope; defaults to the `…/app/<project>` segment of the URL. */
  projectId?: string;
  /** CSS class for the outer container. */
  className?: string;
}

/**
 * `<Chat agent="space/agent" />` — drop-in agent chat for a page app.
 */
export function Chat({ agent, projectId, className }: ChatProps): React.ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const startedOnceRef = useRef(false);

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

  // Create the session once on mount.
  useEffect(() => {
    if (startedOnceRef.current) return;
    startedOnceRef.current = true;
    void startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div style={{ ...styles.container, ...styles.center }} className={className}>
        <p style={{ color: 'var(--destructive)', textAlign: 'center', marginBottom: 8 }}>
          Failed to start chat: {error}
        </p>
        <button
          onClick={() => {
            startedOnceRef.current = false;
            void startSession();
          }}
          style={styles.sendButton}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div style={{ ...styles.container, ...styles.center }} className={className}>
        <span style={{ color: 'var(--muted-foreground)' }}>Starting agent session…</span>
      </div>
    );
  }

  // Same token for the WS (`&access_token=`) and the `/api/sessions/:id/*` HTTP
  // sub-routes — both flow through the JWT-gated `/api/*` proxy on the platform.
  return (
    <ReplChatView
      baseUrl={originBase()}
      sessionId={sessionId}
      accessToken={platformAccessToken()}
      className={className}
      onRestart={() => {
        startedOnceRef.current = false;
        void startSession();
      }}
      restartDisabled={runningRef.current}
    />
  );
}

// ── Styles (design tokens only — no raw colors) ──────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  } as React.CSSProperties,
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  sendButton: {
    padding: '0 16px',
    borderRadius: 4,
    border: 'none',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    fontWeight: 500,
    cursor: 'pointer',
    alignSelf: 'flex-end',
  } as React.CSSProperties,
};
