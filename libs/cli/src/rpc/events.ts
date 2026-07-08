import type { TraceEvent } from '@lmthing/core';

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
  | { type: 'ui_control'; action: UiControlAction }
  // ─── terminal (PTY control socket) — kept identical to
  //     computer/src/lib/runtime/ws-protocol.ts ───
  | { type: 'terminal.opened'; sessionId: string }
  | { type: 'terminal.data'; sessionId: string; data: string }
  // ─── control socket auth (Envoy already validated JWT; confirms to client) ───
  | { type: 'auth.ok' };

/** A chat attachment as the client sends it back with a message. Mirrors the
 *  server's `AttachmentRef` (server/uploads.ts) — the server trusts only `id`
 *  (re-reads bytes/metadata from disk), the rest lets the UI render optimistically. */
export interface ChatAttachmentRef {
  id: string;
  kind: 'image' | 'audio' | 'file';
  mediaType: string;
  filename?: string;
  url: string;
  transcript?: string;
}

export type ClientMessage =
  | { type: 'sendMessage'; content: string; attachments?: ChatAttachmentRef[] }
  | { type: 'submitForm'; id: string; value: unknown }
  | { type: 'cancelAsk'; id: string }
  | { type: 'subscribeTrace'; sinceSeq?: number }
  // ─── terminal (PTY control socket) — kept identical to
  //     computer/src/lib/runtime/ws-protocol.ts ───
  | { type: 'terminal.open'; sessionId: string }
  | { type: 'terminal.input'; sessionId: string; data: string }
  | { type: 'terminal.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'terminal.close'; sessionId: string };
