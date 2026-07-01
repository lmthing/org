import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReplSession } from '../client/useReplSession.js';
import { ReplRpcClient } from '../client/rpc-client.js';
import { DisplayBlock } from './DisplayBlock.js';
import { AskBlock } from './AskBlock.js';
import { VariablesBlock } from './VariablesBlock.js';

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
  const [inputValue, setInputValue] = useState('');
  // The resolved bearer token, captured when the session is created so the
  // WebSocket (opened synchronously by useReplSession) can carry it as
  // ?access_token=… — required when the pod sits behind a JWT-checking gateway.
  const [wsToken, setWsToken] = useState<string>('');
  // Locally-echoed user messages. The agent stream (`blocks`) only carries the
  // agent's display/ask/variables output, never the user's own turns — so we
  // track them here and interleave them into the transcript by recording how
  // many agent blocks existed when each was sent.
  const [userMsgs, setUserMsgs] = useState<{ id: string; text: string; afterBlock: number }[]>([]);
  const runningRef = useRef(false);
  const startedOnceRef = useRef(false);
  const blocksEndRef = useRef<HTMLDivElement | null>(null);

  const resolveToken = useCallback(async (): Promise<string> => {
    const t = getAccessToken();
    return t instanceof Promise ? t : Promise.resolve(t);
  }, [getAccessToken]);

  const startSession = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSessionError(null);
    setSessionId(null);
    setUserMsgs([]);

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

  const { blocks, sendMessage, submitForm, cancelAsk, isConnected, isDone } = useReplSession(
    sessionId
      ? { baseUrl: computeBaseUrl, sessionId, accessToken: wsToken || undefined }
      : { baseUrl: computeBaseUrl, sessionId: '' },
  );

  // Scroll to bottom whenever the transcript grows.
  useEffect(() => {
    blocksEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks, userMsgs.length]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !isConnected) return;
    setUserMsgs((prev) => [
      ...prev,
      { id: `u-${Date.now()}-${prev.length}`, text, afterBlock: blocks.length },
    ]);
    sendMessage(text);
    setInputValue('');
  }, [inputValue, isConnected, sendMessage, blocks.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Error state ──────────────────────────────────────────────────────────

  if (sessionError) {
    return (
      <div style={{ ...styles.container, ...styles.center, ...style }} className={className}>
        <p style={{ color: 'var(--destructive)', textAlign: 'center', marginBottom: 8 }}>
          Failed to start session: {sessionError}
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

  // ── Loading state ────────────────────────────────────────────────────────

  if (!sessionId) {
    return (
      <div style={{ ...styles.container, ...styles.center, ...style }} className={className}>
        <span style={{ color: 'var(--muted-foreground)' }}>{PHASE_LABEL[phase]}</span>
      </div>
    );
  }

  // ── Ready state ──────────────────────────────────────────────────────────

  return (
    <div style={{ ...styles.container, ...style }} className={className}>
      {/* Status bar */}
      <div style={styles.statusBar}>
        <span style={{ color: isConnected ? 'var(--success)' : 'var(--destructive)', fontSize: 12 }}>
          {isConnected ? '● Connected' : '○ Connecting…'}
        </span>
        {isDone && (
          <span style={{ marginLeft: 12, color: 'var(--muted-foreground)', fontSize: 12 }}>Done</span>
        )}
        <button
          onClick={() => {
            startedOnceRef.current = false;
            void startSession();
          }}
          disabled={runningRef.current || phase !== 'ready'}
          style={styles.resyncButton}
          title="Restart the agent session"
        >
          ↻ Restart
        </button>
      </div>

      {/* Transcript: user messages interleaved with agent blocks */}
      <div style={styles.blocks}>
        {(() => {
          const renderAgentBlock = (block: (typeof blocks)[number]) => {
            if (block.type === 'display') return <DisplayBlock key={block.id} descriptor={block.data} />;
            if (block.type === 'ask')
              return (
                <AskBlock key={block.id} id={block.id} descriptor={block.data} onSubmit={submitForm} onCancel={cancelAsk} />
              );
            if (block.type === 'variables')
              return <VariablesBlock key={block.id} vars={block.data as Record<string, unknown>} />;
            if (block.type === 'error')
              return (
                <div key={block.id} style={styles.errorBlock}>
                  {String(block.data)}
                </div>
              );
            return null;
          };
          const userBubble = (m: { id: string; text: string }) => (
            <div key={m.id} style={styles.userMsg}>
              {m.text}
            </div>
          );

          const out: React.ReactNode[] = [];
          let u = 0;
          for (let i = 0; i < blocks.length; i++) {
            while (u < userMsgs.length && userMsgs[u]!.afterBlock <= i) out.push(userBubble(userMsgs[u++]!));
            out.push(renderAgentBlock(blocks[i]!));
          }
          // Trailing user messages (sent after the last agent block, incl. the
          // newest turn that hasn't produced output yet).
          while (u < userMsgs.length) out.push(userBubble(userMsgs[u++]!));
          return out;
        })()}
        <div ref={blocksEndRef} />
      </div>

      {/* Input */}
      <div style={styles.inputRow}>
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message agent… (Enter to send, Shift+Enter for newline)"
          disabled={!isConnected}
          style={styles.textarea}
          rows={2}
        />
        <button
          onClick={handleSend}
          disabled={!isConnected || !inputValue.trim()}
          style={styles.sendButton}
        >
          Send
        </button>
      </div>
    </div>
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
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  } as React.CSSProperties,
  resyncButton: {
    marginLeft: 'auto',
    padding: '2px 10px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
    fontSize: 12,
    cursor: 'pointer',
  } as React.CSSProperties,
  blocks: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  userMsg: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    borderRadius: '12px 12px 2px 12px',
    padding: '6px 12px',
    fontSize: 14,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  errorBlock: {
    background: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--destructive) 35%, transparent)',
    borderRadius: 4,
    padding: '8px 12px',
    color: 'var(--destructive)',
    fontFamily: 'monospace',
    fontSize: 13,
  } as React.CSSProperties,
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  } as React.CSSProperties,
  textarea: {
    flex: 1,
    resize: 'none' as const,
    padding: '8px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    fontSize: 14,
    fontFamily: 'inherit',
  },
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
