// ─── WS client wiring (live mode) ────────────────────────────────────────────
// Drives the store from the trace WebSocket: batches incoming trace events
// per animation frame, and translates hello/ask/error/done/ui_control
// messages into store actions. Kept separate from store.ts to keep the
// composition root thin; takes the store instance as a parameter (via
// `createConnectLive`) rather than importing it, so there's no circular
// module dependency between this file and store.ts.

import { buildModel, parentNodeIds, type WireEvent } from './model';
import { computeTotalCostFromEvents, inflightTurns } from './pricing-slice';
import type { AppState, InspectorTab } from './types';
import type { StoreApi } from 'zustand';
import type { TraceEvent } from '@lmthing/core';

export interface UiControl {
  select?: string;
  tab?: string;
  follow?: boolean;
  seek?: number;
}

/** Bind `connectLive` to a concrete store instance. store.ts calls this once
 *  with `useStore` and re-exports the result, so consumers keep calling
 *  `connectLive(wsUrl)` exactly as before. */
export function createConnectLive(useStore: Pick<StoreApi<AppState>, 'getState' | 'setState'>) {
  return function connectLive(wsUrl: string): {
    send: (msg: unknown) => void;
    close: () => void;
  } {
  let ws: WebSocket | null = null;
  let backoff = 500;
  let closed = false;
  // Per-frame batching of incoming trace events.
  let pending: WireEvent[] = [];
  let rafQueued = false;
  const flush = () => {
    rafQueued = false;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    useStore.getState().feedLive(batch);
  };
  const queue = (we: WireEvent) => {
    pending.push(we);
    if (!rafQueued) {
      rafQueued = true;
      (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16))(flush);
    }
  };

  const open = () => {
    ws = new WebSocket(wsUrl);
    const st = useStore.getState();
    ws.onopen = () => { backoff = 500; st.setConnection('open'); };
    ws.onclose = () => {
      useStore.getState().setConnection('closed');
      if (!closed) setTimeout(open, backoff = Math.min(backoff * 2, 8000));
    };
    ws.onerror = () => { /* close handler reconnects */ };
    ws.onmessage = (e: MessageEvent) => {
      let msg: { type: string; [k: string]: unknown };
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      const store = useStore.getState();
      switch (msg.type) {
        case 'hello':
          store.setHello({ spaceName: String(msg.spaceName ?? ''), agentSlug: String(msg.agentSlug ?? '') });
          break;
        case 'trace_snapshot': {
          // Rebuild the model wholesale from the snapshot (handles connect /
          // resume / reconnect). Unlike live `trace` events (which auto-expand
          // in feedLive as node_start arrives), a snapshot rebuild would otherwise
          // leave `expanded` empty and the tree would render as a single collapsed
          // root row — so auto-expand every node that has children.
          const events = (msg.events as WireEvent[]) ?? [];
          const wireEvents = events.map((x) => ({ seq: x.seq, event: x.event }));
          const rebuilt = buildModel(wireEvents);
          inflightTurns.clear();
          // Recover the agent-set title from the snapshot (last one wins) so a
          // resumed/reconnected session shows its title in the header immediately.
          let snapshotTitle: string | undefined;
          for (const { event } of wireEvents) {
            if (event.type === 'session_meta' && event.title) snapshotTitle = event.title;
          }
          useStore.setState((s) => {
            const expanded = new Set(s.expanded);
            for (const id of parentNodeIds(rebuilt)) expanded.add(id);
            return {
              model: rebuilt,
              version: s.version + 1,
              expanded,
              selectedNodeId: s.selectedNodeId ?? rebuilt.rootId,
              sessionCostUsd: computeTotalCostFromEvents(wireEvents, s.prices),
              sessionCostInflight: 0,
              ...(snapshotTitle !== undefined ? { sessionTitle: snapshotTitle } : {}),
            };
          });
          break;
        }
        case 'trace':
          queue({ seq: msg.seq as number, event: msg.event as TraceEvent });
          break;
        case 'display':
          // display also arrives as a trace event; ignore the legacy duplicate.
          break;
        case 'ask_start':
          store.noteAskStart(String(msg.id), msg.descriptor);
          break;
        case 'ask_end':
          store.noteAskEnd(String(msg.id), msg.value, false);
          break;
        case 'ask_pending':
          for (const a of (msg.asks as Array<{ id: string; descriptor: unknown }>) ?? []) store.noteAskStart(a.id, a.descriptor);
          break;
        case 'error':
          store.noteError(String(msg.message));
          break;
        case 'done':
          store.setDone(true);
          break;
        case 'ui_control': {
          const a = msg.action as UiControl;
          if (a.select) store.selectNode(a.select, false);
          if (a.tab) store.setTab(a.tab as InspectorTab);
          if (typeof a.follow === 'boolean') store.setFollow(a.follow);
          if (typeof a.seek === 'number') store.seek(a.seek);
          break;
        }
      }
    };
  };
  open();

  return {
    send: (msg: unknown) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => { closed = true; ws?.close(); },
  };
  };
}
