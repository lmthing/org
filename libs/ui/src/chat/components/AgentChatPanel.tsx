import * as Prim from '../../elements/primitives/index.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReplRpcClient } from '../client/rpc-client.js';
import { ReplChatView } from './ReplChatView.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Session target: either an already-synced spaceDir + agentSlug, or a
 *  files map that AgentChatPanel will sync before creating the session. */
export type SessionTarget =
  | { mode: 'spaceDir'; spaceDir: string; agentSlug: string }
  | { mode: 'sync'; spaceName: string; files: Record<string, string>; agentSlug: string }
  | { mode: 'agentOnly'; agentSlug: string };

export interface AgentChatPanelProps {
  /** HTTP/WS origin of the compute pod (e.g. https://computer.test). */
  computeBaseUrl: string;
  /** Synchronous or async bearer token provider. */
  getAccessToken: () => string | Promise<string>;
  /** What agent/space to target on the pod. */
  target: SessionTarget;
  /**
   * Optional: called after the panel successfully creates a session so the
   * parent can persist or display the session id.
   */
  onSessionCreated?: (sessionId: string) => void;
  /** CSS class applied to the outermost container div. */
  className?: string;
  /** Inline style applied to the outermost container div. */
  style?: React.CSSProperties;
}

type RunPhase = 'idle' | 'syncing' | 'starting' | 'ready';

const PHASE_LABEL: Record<RunPhase, string> = {
  idle: 'Starting agent session…',
  syncing: 'Syncing space to pod…',
  starting: 'Starting agent session…',
  ready: 'Ready',
};

// ── Component ──────────────────────────────────────────────────────────────

/**
 * AgentChatPanel — a self-contained, embeddable chat panel that:
 *  1. Optionally syncs a file map to the pod (`mode: 'sync'`).
 *  2. Creates a server-side agent session via `POST /api/sessions`.
 *  3. Streams blocks over WebSocket using `useReplSession`.
 *  4. Renders display/ask/variables/error blocks and provides a message input.
 *
 * For the built-in "thing" agent no file sync is needed — pass
 * `{ mode: 'agentOnly', agentSlug: 'thing' }`.
 */
export function AgentChatPanel({
  computeBaseUrl,
  getAccessToken,
  target,
  onSessionCreated,
  className,
  style,
}: AgentChatPanelProps): React.ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [sessionError, setSessionError] = useState<string | null>(null);
  // The resolved bearer token, captured when the session is created so the
  // WebSocket (opened synchronously by ReplChatView) can carry it as
  // ?access_token=… — required when the pod sits behind a JWT-checking gateway.
  const [wsToken, setWsToken] = useState<string>('');
  const runningRef = useRef(false);
  const startedOnceRef = useRef(false);

  const resolveToken = useCallback(async (): Promise<string> => {
    const t = getAccessToken();
    return t instanceof Promise ? t : Promise.resolve(t);
  }, [getAccessToken]);

  const startSession = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSessionError(null);
    setSessionId(null);

    try {
      let spaceDir: string | undefined;
      const agentSlug = target.agentSlug;

      if (target.mode === 'sync') {
        setPhase('syncing');
        const token = await resolveToken();
        const result = await ReplRpcClient.syncSpace(
          computeBaseUrl,
          target.spaceName,
          target.files,
          token,
        );
        spaceDir = result.spaceDir;
      } else if (target.mode === 'spaceDir') {
        spaceDir = target.spaceDir;
      }
      // mode === 'agentOnly': spaceDir stays undefined, server resolves via lmthingRoot

      setPhase('starting');
      const token = await resolveToken();
      setWsToken(token);
      const client = await ReplRpcClient.createSession(
        computeBaseUrl,
        { spaceDir, agentSlug },
        token,
      );
      const sid = client.sessionId!;
      setSessionId(sid);
      setPhase('ready');
      onSessionCreated?.(sid);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    } finally {
      runningRef.current = false;
    }
  }, [computeBaseUrl, target, resolveToken, onSessionCreated]);

  // Auto-start. For sync mode, delay until files are non-empty to avoid
  // syncing an empty space on first render.
  useEffect(() => {
    if (startedOnceRef.current) return;

    if (target.mode === 'sync' && Object.keys(target.files).length === 0) return;

    startedOnceRef.current = true;
    void startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startSession,
    // Re-trigger when files become available in sync mode.
    target.mode === 'sync' ? Object.keys(target.files).length : 0,
  ]);

  // ── Error state ──────────────────────────────────────────────────────────

  if (sessionError) {
    return (
      <Prim.Box style={{ ...styles.container, ...styles.center, ...style }} className={className}>
        <Prim.Text as="p" color="var(--destructive)" textAlign="center" marginBottom={8}>
          Failed to start session: {sessionError}
        </Prim.Text>
        <Prim.Pressable
          onClick={() => {
            startedOnceRef.current = false;
            void startSession();
          }}
          style={styles.sendButton}
        >
          Retry
        </Prim.Pressable>
      </Prim.Box>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────

  if (!sessionId) {
    return (
      <Prim.Box style={{ ...styles.container, ...styles.center, ...style }} className={className}>
        <Prim.Text color="var(--muted-foreground)">{PHASE_LABEL[phase]}</Prim.Text>
      </Prim.Box>
    );
  }

  // ── Ready state ──────────────────────────────────────────────────────────

  return (
    <ReplChatView
      baseUrl={computeBaseUrl}
      sessionId={sessionId}
      accessToken={wsToken || undefined}
      className={className}
      style={style}
      onRestart={() => {
        startedOnceRef.current = false;
        void startSession();
      }}
      restartDisabled={runningRef.current || phase !== 'ready'}
    />
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
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
