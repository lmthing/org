import type { TraceEvent } from '@repl/core';

/** Agent/UI control action — lets the HTTP API drive the browser UI. */
export type UiControlAction =
  | { select: string }            // focus a tree node by id
  | { tab: string }               // switch inspector tab
  | { follow: boolean }           // toggle auto-follow
  | { seek: number };             // replay: seek to a seq

export type ServerEvent =
  // ─── legacy/interaction events (kept for the Ink path + back-compat) ───
  | { type: 'snapshot'; data: unknown }
  | { type: 'display'; descriptor: unknown }
  | { type: 'ask_start'; id: string; descriptor: unknown }
  | { type: 'ask_end'; id: string; value?: unknown }
  | { type: 'variables'; vars: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done' }
  // ─── observability events ───
  | { type: 'hello'; protocolVersion: 1; sessionId: string; spaceName: string; agentSlug: string; traceAvailable: boolean }
  | { type: 'trace'; seq: number; event: TraceEvent }
  | { type: 'trace_snapshot'; events: Array<{ seq: number; event: TraceEvent }>; lastSeq: number; truncatedBefore?: number }
  | { type: 'ask_pending'; asks: Array<{ id: string; nodeId?: string; descriptor: unknown }> }
  | { type: 'ui_control'; action: UiControlAction };

export type ClientMessage =
  | { type: 'sendMessage'; content: string }
  | { type: 'submitForm'; id: string; value: unknown }
  | { type: 'cancelAsk'; id: string }
  | { type: 'subscribeTrace'; sinceSeq?: number };
