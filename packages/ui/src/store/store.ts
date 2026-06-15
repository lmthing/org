import { create } from 'zustand';
import {
  type SessionModel, type WireEvent, emptyModel, buildModel, applyWireEvent,
  pushUserBlock, pushErrorBlock, pushAskBlock, resolveAskBlock,
} from './model.js';
import type { TraceEvent } from '@lmthing/core';

export type InspectorTab = 'llm' | 'statements' | 'yields' | 'variables' | 'raw';
export type Mode = 'live' | 'replay';
export type Connection = 'connecting' | 'open' | 'closed';

interface ReplayState {
  events: WireEvent[];
  cursor: number;       // index into events (exclusive upper bound applied)
  playing: boolean;
  speed: number;
}

interface AppState {
  mode: Mode;
  connection: Connection;
  model: SessionModel;
  version: number;             // bumped on every committed batch — selectors key on this
  selectedNodeId: string | null;
  userSelected: boolean;       // true once the user clicks a node (suppresses auto-select)
  tab: InspectorTab;
  follow: boolean;
  expanded: Set<string>;
  done: boolean;
  spaceName: string;
  agentSlug: string;
  replay: ReplayState | null;

  // actions
  feedLive: (events: WireEvent[]) => void;
  setConnection: (c: Connection) => void;
  setHello: (h: { spaceName: string; agentSlug: string }) => void;
  setDone: (d: boolean) => void;
  selectNode: (id: string | null, byUser?: boolean) => void;
  setTab: (t: InspectorTab) => void;
  toggleExpand: (id: string) => void;
  setExpanded: (id: string, v: boolean) => void;
  setFollow: (f: boolean) => void;
  noteUserMessage: (content: string) => void;
  noteError: (message: string) => void;
  noteAskStart: (askId: string, descriptor: unknown) => void;
  noteAskEnd: (askId: string, value: unknown, cancelled?: boolean) => void;
  // replay
  loadReplay: (events: WireEvent[]) => void;
  seek: (cursor: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (s: number) => void;
  exitReplay: () => void;
}

function recomputeReplayModel(events: WireEvent[], cursor: number): SessionModel {
  const slice = events.slice(0, cursor);
  return buildModel(slice);
}

export const useStore = create<AppState>((set, get) => ({
  mode: 'live',
  connection: 'connecting',
  model: emptyModel(),
  version: 0,
  selectedNodeId: null,
  userSelected: false,
  tab: 'statements',
  follow: true,
  expanded: new Set<string>(),
  done: false,
  spaceName: '',
  agentSlug: '',
  replay: null,

  feedLive: (events) => {
    const s = get();
    if (s.mode === 'replay') return;
    const m = s.model;
    let autoExpand = s.expanded;
    let mutatedExpand = false;
    for (const we of events) {
      applyWireEvent(m, we);
      // Auto-expand running nodes while following
      if (s.follow && we.event.type === 'node_start') {
        if (!autoExpand.has(we.event.nodeId)) {
          if (!mutatedExpand) { autoExpand = new Set(autoExpand); mutatedExpand = true; }
          autoExpand.add(we.event.nodeId);
          if (we.event.parentId) autoExpand.add(we.event.parentId);
        }
      }
    }
    // Auto-select the most recent running node unless the user has chosen one.
    let nextSel = s.selectedNodeId;
    if (s.follow && !s.userSelected) {
      const lastStart = [...events].reverse().find((w) => w.event.type === 'node_start');
      if (lastStart) nextSel = (lastStart.event as { nodeId: string }).nodeId;
      else if (!nextSel && m.rootId) nextSel = m.rootId;
    }
    set({
      version: s.version + 1,
      ...(mutatedExpand ? { expanded: autoExpand } : {}),
      ...(nextSel !== s.selectedNodeId ? { selectedNodeId: nextSel } : {}),
    });
  },

  setConnection: (connection) => set({ connection }),
  setHello: (h) => set({ spaceName: h.spaceName, agentSlug: h.agentSlug }),
  setDone: (done) => set({ done }),
  selectNode: (id, byUser = false) => set((s) => ({ selectedNodeId: id, userSelected: byUser || s.userSelected })),
  setTab: (tab) => set({ tab }),
  toggleExpand: (id) => set((s) => {
    const e = new Set(s.expanded);
    if (e.has(id)) e.delete(id); else e.add(id);
    return { expanded: e };
  }),
  setExpanded: (id, v) => set((s) => {
    const e = new Set(s.expanded);
    if (v) e.add(id); else e.delete(id);
    return { expanded: e };
  }),
  setFollow: (follow) => set({ follow }),

  noteUserMessage: (content) => set((s) => { pushUserBlock(s.model, content); return { version: s.version + 1, done: false }; }),
  noteError: (message) => set((s) => { pushErrorBlock(s.model, message); return { version: s.version + 1 }; }),
  noteAskStart: (askId, descriptor) => set((s) => { pushAskBlock(s.model, askId, descriptor); return { version: s.version + 1 }; }),
  noteAskEnd: (askId, value, cancelled) => set((s) => { resolveAskBlock(s.model, askId, value, cancelled); return { version: s.version + 1 }; }),

  // ─── Replay ───
  loadReplay: (events) => {
    const cursor = events.length;
    set({
      mode: 'replay',
      replay: { events, cursor, playing: false, speed: 1 },
      model: recomputeReplayModel(events, cursor),
      version: get().version + 1,
      done: true,
    });
  },
  seek: (cursor) => set((s) => {
    if (!s.replay) return {};
    const c = Math.max(0, Math.min(cursor, s.replay.events.length));
    return {
      replay: { ...s.replay, cursor: c },
      model: recomputeReplayModel(s.replay.events, c),
      version: s.version + 1,
    };
  }),
  play: () => set((s) => (s.replay ? { replay: { ...s.replay, playing: true } } : {})),
  pause: () => set((s) => (s.replay ? { replay: { ...s.replay, playing: false } } : {})),
  setSpeed: (speed) => set((s) => (s.replay ? { replay: { ...s.replay, speed } } : {})),
  exitReplay: () => set({ mode: 'live', replay: null }),
}));

// ─── WS client wiring (live mode) ────────────────────────────────────────────

export interface UiControl {
  select?: string;
  tab?: string;
  follow?: boolean;
  seek?: number;
}

export function connectLive(wsUrl: string): {
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
          // Rebuild the model wholesale from the snapshot (handles reconnect).
          const events = (msg.events as WireEvent[]) ?? [];
          const rebuilt = buildModel(events.map((x) => ({ seq: x.seq, event: x.event })));
          useStore.setState((s) => ({ model: rebuilt, version: s.version + 1, selectedNodeId: s.selectedNodeId ?? rebuilt.rootId }));
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
}
