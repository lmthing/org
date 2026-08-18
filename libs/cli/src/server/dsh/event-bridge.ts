/**
 * dsh → lmthing trace bridge.
 *
 * The DeepSeek Harness runtime emits its own append-only `SessionEvent` stream.
 * The lmthing pod renders from lmthing `TraceEvent`s pushed onto a {@link Tracer}
 * (the web client, DevTools, and the NDJSON trace all read that). This module is
 * the pure translation between the two: given one dsh session event, push the
 * equivalent lmthing trace event(s) onto a Tracer.
 *
 * It is deliberately free of any dsh import — it operates on the structural
 * shapes dsh actually emits (verified against
 * `packages/client/connection/src/client/fixture.ts` in the dsh tree) — so it
 * typechecks and unit-tests without the dsh packages present.
 *
 * The mapping keeps lmthing's mental model intact, which is what makes a dsh turn
 * render in the existing UI with no client changes:
 *
 * | dsh event | lmthing trace event(s) |
 * |---|---|
 * | `assistant/message` text block | `display` (the visible answer) + `llm_response` (trace) |
 * | `assistant/chunk` text-delta | `llm_progress` (streaming feel) |
 * | `tool/call` name=`run_code` | `statement` (the model's TypeScript program) |
 * | `tool/call` native tool | `yield` (kind = tool name) |
 * | `tool/result` native tool | `yield_resolved` |
 * | `tool/code-dispatch-start` | `yield` (a Code-Mode sub-call) |
 * | `tool/code-dispatch` | `yield_resolved` |
 * | `turn/end` | `turn_end` |
 *
 * A user/message event is intentionally NOT bridged: the manager already writes
 * the `user_message` trace event before the turn starts.
 */

import type { Tracer, TraceEvent } from '@lmthing/core';

// ─── Structural shapes of the dsh events we read ────────────────────────────
// Minimal, field-for-field with what dsh emits; `unknown`/index signatures keep
// us tolerant of the fields we don't consume.

interface DshTextBlock { type: 'text'; text: string }
interface DshToolCallBlock { type: 'tool-call'; id?: string; name?: string; arguments?: unknown }
type DshContentBlock = DshTextBlock | DshToolCallBlock | { type: string; [k: string]: unknown };

interface DshMessage { content?: DshContentBlock[]; isError?: boolean }
interface DshStreamChunk { type: string; text?: string }

export interface DshSessionEvent {
  type: string;
  data?: {
    turn?: number;
    step?: number;
    message?: DshMessage;
    chunk?: DshStreamChunk;
    callId?: string;
    subCallId?: string;
    name?: string;
    arguments?: unknown;
    content?: DshContentBlock[];
    isError?: boolean;
    reason?: { kind?: string };
    [k: string]: unknown;
  };
}

// ─── Extraction helpers ─────────────────────────────────────────────────────

function isTextBlock(b: DshContentBlock): b is DshTextBlock {
  return b.type === 'text' && typeof (b as DshTextBlock).text === 'string';
}

/** Concatenate the text of every text block in a content array. */
export function blocksText(blocks: DshContentBlock[] | undefined): string {
  if (!blocks) return '';
  return blocks.filter(isTextBlock).map((b) => b.text).join('');
}

/** Parse a tool-call `arguments` payload, which dsh sends as a JSON string on
 *  `tool/call` and as an object on `tool/code-dispatch`. Returns `{}` on any
 *  parse failure so a malformed argument never breaks the bridge. */
export function parseArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object') return args as Record<string, unknown>;
  if (typeof args === 'string') {
    try {
      const v = JSON.parse(args) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v };
    } catch {
      return { raw: args };
    }
  }
  return {};
}

/** The name dsh's Code Mode gives its single program-running tool. */
export const RUN_CODE_TOOL = 'run_code';

// ─── The bridge ─────────────────────────────────────────────────────────────

export interface BridgeScope {
  /** The trace `context` label written on every event (e.g. 'session'). */
  context: string;
  /** The execution-tree node id every event is attributed to. */
  nodeId: string;
}

/**
 * Create a stateful bridge for one dsh session. Feed it each dsh `SessionEvent`;
 * it pushes the equivalent lmthing trace event(s) onto `tracer`. State is only
 * the call-id → tool-name map (so a `tool/result` knows which tool it settles)
 * and the streamed-char counter (for `llm_progress`).
 */
export function createDshTraceBridge(
  tracer: Tracer,
  scope: BridgeScope,
): (event: DshSessionEvent) => void {
  const { context, nodeId } = scope;
  const callNames = new Map<string, string>();
  let streamedChars = 0;

  const emit = (e: TraceEvent): void => tracer.write(e);

  return function bridge(event: DshSessionEvent): void {
    const now = Date.now();
    const data = event.data ?? {};

    switch (event.type) {
      case 'assistant/chunk': {
        const chunk = data.chunk;
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          streamedChars += chunk.text.length;
          emit({ ts: now, type: 'llm_progress', context, nodeId, chars: streamedChars, statements: 0 });
        }
        return;
      }

      case 'assistant/message': {
        const answer = blocksText(data.message?.content);
        if (answer.length > 0) {
          // The visible answer (lmthing renders `display` in the chat) …
          emit({ ts: now, type: 'display', context, nodeId, descriptor: answer });
          // … and the same text in the trace as the model response.
          emit({ ts: now, type: 'llm_response', context, nodeId, attempt: 0, text: answer });
        }
        return;
      }

      case 'tool/call': {
        const name = typeof data.name === 'string' ? data.name : 'tool';
        if (typeof data.callId === 'string') callNames.set(data.callId, name);
        const args = parseArgs(data.arguments);
        if (name === RUN_CODE_TOOL) {
          // The model's TypeScript program — render it like an lmthing statement.
          const code = typeof args['code'] === 'string' ? (args['code'] as string) : '';
          emit({ ts: now, type: 'statement', context, nodeId, code });
        } else {
          emit({
            ts: now, type: 'yield', context, nodeId, kind: name, args,
            ...(typeof data.callId === 'string' ? { yieldId: data.callId } : {}),
          });
        }
        return;
      }

      case 'tool/result': {
        // dsh carries the tool name on the earlier tool/call; recover it by callId.
        const name = (typeof data.callId === 'string' && callNames.get(data.callId)) || undefined;
        if (name === RUN_CODE_TOOL || name === undefined) return; // run_code's answer arrives via assistant/message
        emit({
          ts: now, type: 'yield_resolved', context, nodeId, kind: name,
          value: blocksText(data.message?.content),
          ...(typeof data.callId === 'string' ? { yieldId: data.callId } : {}),
        });
        return;
      }

      case 'tool/code-dispatch-start': {
        // A composed sub-call inside a run_code program begins.
        const name = typeof data.name === 'string' ? data.name : 'tool';
        emit({
          ts: now, type: 'yield', context, nodeId, kind: name, args: parseArgs(data.arguments),
          ...(typeof data.subCallId === 'string' ? { yieldId: data.subCallId } : {}),
        });
        return;
      }

      case 'tool/code-dispatch': {
        // …and settles with its result content.
        const name = typeof data.name === 'string' ? data.name : 'tool';
        emit({
          ts: now, type: 'yield_resolved', context, nodeId, kind: name,
          value: blocksText(data.content),
          ...(typeof data.subCallId === 'string' ? { yieldId: data.subCallId } : {}),
        });
        return;
      }

      case 'turn/end': {
        emit({ ts: now, type: 'turn_end', context, nodeId, reason: data.reason?.kind ?? 'completed' });
        return;
      }

      default:
        return; // every other dsh event is not surfaced (durable in dsh's own log)
    }
  };
}
