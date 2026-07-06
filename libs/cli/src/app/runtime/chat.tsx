/**
 * `<Chat>` — the page-droppable agent chat widget of `@app/runtime`.
 *
 * A page renders `<Chat agent="space/agent" />` and gets the agent's
 * turn-by-turn stream, rendered with the **`@lmthing/ui` catalog descriptor
 * renderer** (`DisplayBlock`/`AskBlock`/`VariablesBlock`) — this is the ONE place
 * that renderer lives inside a page app (pages are otherwise real React; the chat
 * widget is the exception). `ask()` form answers round-trip over the same socket,
 * exactly as `/chat` does.
 *
 * It reuses the standard pod chat protocol wholesale:
 *   1. `POST /api/sessions` `{ spaceRef, projectId }`  →  `{ sessionId }`.
 *   2. `useReplSession({ baseUrl, sessionId })` opens `WS /api/ws?sessionId=<id>`,
 *      streams display/ask/variables/error blocks, and posts user messages +
 *      ask answers back to `/api/sessions/:id/*`.
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
import {
  useReplSession,
  DisplayBlock,
  AskBlock,
  VariablesBlock,
  getAccessToken,
  type ReplBlock,
} from '@lmthing/ui/chat';

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
  const [input, setInput] = useState('');
  // Locally-echoed user turns — the agent stream only carries the agent's own
  // output, so we interleave user messages by recording how many agent blocks
  // existed when each was sent (mirrors AgentChatPanel).
  const [userMsgs, setUserMsgs] = useState<{ id: string; text: string; afterBlock: number }[]>([]);
  const startedRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Create the session once on mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const pid = projectId ?? resolveProjectId(window.location.pathname);
        const sid = await createChatSession(agent, pid, originBase(), platformAccessToken());
        setSessionId(sid);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same token for the WS (`&access_token=`) and the `/api/sessions/:id/*` HTTP
  // sub-routes — both flow through the JWT-gated `/api/*` proxy on the platform.
  const accessToken = platformAccessToken();
  const { blocks, sendMessage, submitForm, cancelAsk, isConnected, isDone } = useReplSession(
    sessionId
      ? { baseUrl: originBase(), sessionId, accessToken }
      : { baseUrl: originBase(), sessionId: '', accessToken },
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks, userMsgs.length]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !isConnected) return;
    setUserMsgs((prev) => [
      ...prev,
      { id: `u-${Date.now()}-${prev.length}`, text, afterBlock: blocks.length },
    ]);
    sendMessage(text);
    setInput('');
  }, [input, isConnected, sendMessage, blocks.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (error) {
    return (
      <div style={{ ...styles.container, ...styles.center }} className={className}>
        <p style={{ color: 'var(--destructive)', textAlign: 'center', margin: 0 }}>
          Failed to start chat: {error}
        </p>
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

  const renderAgentBlock = (block: ReplBlock): React.ReactNode => {
    switch (block.type) {
      case 'display':
        return <DisplayBlock key={block.id} descriptor={block.data} />;
      case 'ask':
        return (
          <AskBlock
            key={block.id}
            id={block.id}
            descriptor={block.data}
            onSubmit={submitForm}
            onCancel={cancelAsk}
          />
        );
      case 'variables':
        return <VariablesBlock key={block.id} vars={block.data as Record<string, unknown>} />;
      case 'error':
        return (
          <div key={block.id} style={styles.errorBlock}>
            {String(block.data)}
          </div>
        );
      default:
        return null;
    }
  };

  const userBubble = (m: { id: string; text: string }): React.ReactNode => (
    <div key={m.id} style={styles.userMsg}>
      {m.text}
    </div>
  );

  // Interleave user bubbles with agent blocks by recorded position.
  const transcript: React.ReactNode[] = [];
  let u = 0;
  for (let i = 0; i < blocks.length; i++) {
    while (u < userMsgs.length && userMsgs[u]!.afterBlock <= i) transcript.push(userBubble(userMsgs[u++]!));
    transcript.push(renderAgentBlock(blocks[i]!));
  }
  while (u < userMsgs.length) transcript.push(userBubble(userMsgs[u++]!));

  return (
    <div style={styles.container} className={className}>
      <div style={styles.statusBar}>
        <span style={{ color: isConnected ? 'var(--success)' : 'var(--destructive)', fontSize: 12 }}>
          {isConnected ? '● Connected' : '○ Connecting…'}
        </span>
        {isDone && (
          <span style={{ marginLeft: 12, color: 'var(--muted-foreground)', fontSize: 12 }}>Done</span>
        )}
      </div>

      <div style={styles.blocks}>
        {transcript}
        <div ref={endRef} />
      </div>

      <div style={styles.inputRow}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message agent… (Enter to send, Shift+Enter for newline)"
          disabled={!isConnected}
          style={styles.textarea}
          rows={2}
        />
        <button onClick={handleSend} disabled={!isConnected || !input.trim()} style={styles.sendButton}>
          Send
        </button>
      </div>
    </div>
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
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  } as React.CSSProperties,
  blocks: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  } as React.CSSProperties,
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
