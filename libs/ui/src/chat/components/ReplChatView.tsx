import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReplSession } from '../client/useReplSession.js';
import { DisplayBlock } from './DisplayBlock.js';
import { AskBlock } from './AskBlock.js';
import { VariablesBlock } from './VariablesBlock.js';

export interface ReplChatViewProps {
  /** HTTP/WS origin of the pod (e.g. https://computer.test). */
  baseUrl: string;
  /** An already-created REPL session id. */
  sessionId: string;
  /** Bearer token for the WS (`?access_token=`) and `/api/sessions/:id/*` HTTP calls. */
  accessToken?: string;
  /** CSS class for the outer container. */
  className?: string;
  /** Inline style for the outer container. */
  style?: React.CSSProperties;
  /** Shown as a "↻ Restart" button in the status bar when provided. */
  onRestart?: () => void;
  restartDisabled?: boolean;
}

/**
 * ReplChatView — the connected-session chat surface shared by
 * {@link AgentChatPanel} (studio's embeddable panel) and `@app/runtime`'s
 * `<Chat>` (the page-droppable widget in project apps): status bar,
 * display/ask/variables/error transcript, and the message input.
 *
 * Callers own session creation (the body shape differs: `AgentChatPanel`
 * posts `{ spaceDir, agentSlug }`, `<Chat>` posts `{ spaceRef|agentSlug,
 * projectId }`) and pass the resulting `sessionId` in — everything
 * downstream of that is identical between the two surfaces.
 */
export function ReplChatView({
  baseUrl,
  sessionId,
  accessToken,
  className,
  style,
  onRestart,
  restartDisabled,
}: ReplChatViewProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  // Locally-echoed user messages. The agent stream (`blocks`) only carries the
  // agent's display/ask/variables output, never the user's own turns — so we
  // track them here and interleave them into the transcript by recording how
  // many agent blocks existed when each was sent.
  const [userMsgs, setUserMsgs] = useState<{ id: string; text: string; afterBlock: number }[]>([]);
  const blocksEndRef = useRef<HTMLDivElement | null>(null);

  const { blocks, sendMessage, submitForm, cancelAsk, isConnected, isDone } = useReplSession({
    baseUrl,
    sessionId,
    accessToken,
  });

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

  const renderAgentBlock = (block: (typeof blocks)[number]): React.ReactNode => {
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

  const userBubble = (m: { id: string; text: string }): React.ReactNode => (
    <div key={m.id} style={styles.userMsg}>
      {m.text}
    </div>
  );

  const transcript: React.ReactNode[] = [];
  let u = 0;
  for (let i = 0; i < blocks.length; i++) {
    while (u < userMsgs.length && userMsgs[u]!.afterBlock <= i) transcript.push(userBubble(userMsgs[u++]!));
    transcript.push(renderAgentBlock(blocks[i]!));
  }
  while (u < userMsgs.length) transcript.push(userBubble(userMsgs[u++]!));

  return (
    <div style={{ ...styles.container, ...style }} className={className}>
      <div style={styles.statusBar}>
        <span style={{ color: isConnected ? 'var(--success)' : 'var(--destructive)', fontSize: 12 }}>
          {isConnected ? '● Connected' : '○ Connecting…'}
        </span>
        {isDone && (
          <span style={{ marginLeft: 12, color: 'var(--muted-foreground)', fontSize: 12 }}>Done</span>
        )}
        {onRestart && (
          <button
            onClick={onRestart}
            disabled={restartDisabled}
            style={styles.resyncButton}
            title="Restart the agent session"
          >
            ↻ Restart
          </button>
        )}
      </div>

      <div style={styles.blocks}>
        {transcript}
        <div ref={blocksEndRef} />
      </div>

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
        <button onClick={handleSend} disabled={!isConnected || !inputValue.trim()} style={styles.sendButton}>
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
