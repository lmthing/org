import * as Prim from '../../elements/primitives/index';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReplSession } from '../client/useReplSession';
import { DisplayBlock } from './DisplayBlock';
import { AskBlock } from './AskBlock';
import { VariablesBlock } from './VariablesBlock';
import {
  selectActiveWork,
  latestSubtreeStatement,
  narrationOf,
  workDepth,
  KIND_ICON,
  fmtDuration,
} from '../app/node-meta';
import type { SessionModel } from '../store/model';

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

  const { blocks, model, sendMessage, submitForm, cancelAsk, isConnected, isDone } = useReplSession({
    baseUrl,
    sessionId,
    accessToken,
  });

  const activeWork = selectActiveWork(model);

  // Keep the elapsed timers ticking while work is in flight, even between
  // trace events (which is what would otherwise re-render this view).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (activeWork.length === 0) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [activeWork.length]);

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
        <Prim.Box key={block.id} {...styles.errorBlock}>
          {String(block.data)}
        </Prim.Box>
      );
    return null;
  };

  const userBubble = (m: { id: string; text: string }): React.ReactNode => (
    <Prim.Box key={m.id} style={styles.userMsg}>
      {m.text}
    </Prim.Box>
  );

  const transcript: React.ReactNode[] = [];
  let u = 0;
  for (let i = 0; i < blocks.length; i++) {
    while (u < userMsgs.length && userMsgs[u]!.afterBlock <= i) transcript.push(userBubble(userMsgs[u++]!));
    transcript.push(renderAgentBlock(blocks[i]!));
  }
  while (u < userMsgs.length) transcript.push(userBubble(userMsgs[u++]!));

  return (
    <Prim.Box {...CONTAINER} style={style} className={className}>
      <Prim.Box {...styles.statusBar}>
        <Prim.Text color={isConnected ? 'var(--success)' : 'var(--destructive)'} fontSize={12}>
          {isConnected ? '● Connected' : '○ Connecting…'}
        </Prim.Text>
        {isDone && (
          <Prim.Text marginLeft={12} color="var(--muted-foreground)" fontSize={12}>Done</Prim.Text>
        )}
        {onRestart && (
          <Prim.Pressable
            onClick={onRestart}
            disabled={restartDisabled}
            {...styles.resyncButton}
            title="Restart the agent session"
          >
            ↻ Restart
          </Prim.Pressable>
        )}
      </Prim.Box>

      <Prim.Box {...styles.blocks}>
        {transcript}
        <Prim.Box ref={blocksEndRef} />
      </Prim.Box>

      {activeWork.length > 0 && (
        <Prim.Box {...styles.activityBox} data-testid="repl-live-activity" aria-label="sub-agent activity">
          <Prim.Box {...styles.activityHeader}>
            <Prim.Text {...styles.activityPulse}>●</Prim.Text>
            <Prim.Text>working…</Prim.Text>
            <Prim.Text opacity={0.6}>{activeWork.length} active</Prim.Text>
          </Prim.Box>
          <Prim.Box {...styles.activityList}>
            {activeWork.map((n) => (
              <WorkRow key={n.id} node={n} model={model} />
            ))}
          </Prim.Box>
        </Prim.Box>
      )}

      <Prim.Box {...styles.inputRow}>
        <Prim.TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message agent… (Enter to send, Shift+Enter for newline)"
          disabled={!isConnected}
          style={styles.textarea}
          rows={2}
        />
        <Prim.Pressable onClick={handleSend} disabled={!isConnected || !inputValue.trim()} {...styles.sendButton}>
          Send
        </Prim.Pressable>
      </Prim.Box>
    </Prim.Box>
  );
}

/** One in-flight sub-agent (delegate/fork/tasklist/task): kind icon, label,
 *  its current narration, and elapsed time. Mirrors the full chat's WorkBlock
 *  in a compact, inline-styled row for the embedded surface. */
function WorkRow({
  node,
  model,
}: {
  node: ReturnType<typeof selectActiveWork>[number];
  model: SessionModel;
}): React.ReactElement {
  const depth = workDepth(model, node.id);
  const narration =
    node.activity?.trim() || narrationOf(latestSubtreeStatement(model, node.id)?.code ?? '');
  const elapsed = node.startTs ? fmtDuration(Date.now() - node.startTs) : '';
  return (
    <Prim.Box {...styles.workRow} paddingLeft={12 + depth * 14}>
      <Prim.Text {...styles.workIcon}>{KIND_ICON[node.kind] ?? '•'}</Prim.Text>
      <Prim.Box {...styles.workBody}>
        <Prim.Box {...styles.workLabelLine}>
          <Prim.Text {...styles.workLabel}>{node.label}</Prim.Text>
          {elapsed && <Prim.Text {...styles.workElapsed}>{elapsed}</Prim.Text>}
        </Prim.Box>
        {narration && <Prim.Box {...styles.workNarration}>{narration}</Prim.Box>}
      </Prim.Box>
    </Prim.Box>
  );
}

// ── Styles (design tokens only — no raw colors) ──────────────────────────────

/** Was `styles.container`, the last `CSSProperties` bag here — every key is a real Tamagui prop. */
const CONTAINER = { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } as const

const styles = {

  statusBar: { display: "flex", alignItems: "center", paddingVertical: "4px", paddingHorizontal: "12px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "var(--border)", flexShrink: 0 } as const,
  resyncButton: { marginLeft: "auto", paddingVertical: "2px", paddingHorizontal: "10px", borderRadius: 4, borderWidth: "1px", borderStyle: "solid", borderColor: "var(--border)", backgroundColor: "var(--secondary)", color: "var(--secondary-foreground)", fontSize: 12, cursor: "pointer" } as const,
  blocks: { flexGrow: 1, flexShrink: 1, flexBasis: "0%", overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" } as const,
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
  errorBlock: { backgroundColor: "color-mix(in srgb, var(--destructive) 12%, transparent)", borderWidth: "1px", borderStyle: "solid", borderColor: "color-mix(in srgb, var(--destructive) 35%, transparent)", borderRadius: 4, paddingVertical: "8px", paddingHorizontal: "12px", color: "var(--destructive)", fontFamily: "monospace", fontSize: 13 } as const,
  activityBox: { marginTop: "0", marginHorizontal: "12px", marginBottom: "8px", borderRadius: 8, borderWidth: "1px", borderStyle: "solid", borderColor: "var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)", flexShrink: 0, overflow: "hidden" } as const,
  activityHeader: { display: "flex", alignItems: "center", gap: 6, paddingVertical: "6px", paddingHorizontal: "12px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "var(--border)", fontSize: 12, color: "var(--muted-foreground)" } as const,
  activityPulse: { color: "var(--brand-2, var(--primary))" } as const,
  activityList: { maxHeight: "40vh", overflowY: "auto", paddingVertical: "4px", paddingHorizontal: "0" } as const,
  workRow: { display: "flex", gap: 8, alignItems: "flex-start", paddingVertical: "4px", paddingHorizontal: "12px" } as const,
  workIcon: { color: "var(--brand-2, var(--primary))", fontSize: 13, lineHeight: "18px", flexShrink: 0 } as const,
  workBody: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: "0%" } as const,
  workLabelLine: { display: "flex", alignItems: "baseline", gap: 8 } as const,
  workLabel: { fontSize: 12, fontWeight: 500, color: "var(--foreground)", fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const,
  workElapsed: { fontSize: 11, color: "var(--muted-foreground)", marginLeft: "auto", flexShrink: 0 } as const,
  workNarration: { fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const,
  inputRow: { display: "flex", gap: 8, paddingVertical: "8px", paddingHorizontal: "12px", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "var(--border)", flexShrink: 0 } as const,
  textarea: {
    flex: 1,
    resize: 'none' as const,
    padding: '8px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    fontSize: 14,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  sendButton: { paddingVertical: "0", paddingHorizontal: "16px", borderRadius: 4, borderWidth: 0, backgroundColor: "var(--primary)", color: "var(--primary-foreground)", fontWeight: 500, cursor: "pointer", alignSelf: "flex-end" } as const,
};
