import { create } from 'zustand';
import {
  type SessionModel, type WireEvent, emptyModel, buildModel, applyWireEvent,
  parentNodeIds,
  pushUserBlock, pushErrorBlock, pushAskBlock, resolveAskBlock,
} from './model.js';
import type { TraceEvent } from '@lmthing/core';

export type InspectorTab = 'llm' | 'statements' | 'yields' | 'variables' | 'raw';
export type Mode = 'live' | 'replay';
export type Connection = 'connecting' | 'open' | 'closed';

// ─── Multi-session / project types ───────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface SessionMeta {
  sessionId: string;
  spaceDir: string;
  agentSlug: string;
  lastActivity: string;
  started: string;
  status: string;
}

// ─── Replay state ─────────────────────────────────────────────────────────────

interface ReplayState {
  events: WireEvent[];
  cursor: number;       // index into events (exclusive upper bound applied)
  playing: boolean;
  speed: number;
}

export interface ModelPricing { inputPer1K: number; outputPer1K: number }

function computeEventCost(ev: TraceEvent, prices: Record<string, ModelPricing> | null): number {
  if (!prices || ev.type !== 'llm_response') return 0;
  const e = ev as { type: 'llm_response'; model?: string; inputTokens?: number; outputTokens?: number };
  if (!e.model || typeof e.inputTokens !== 'number' || typeof e.outputTokens !== 'number') return 0;
  const modelId = e.model.includes(':') ? e.model.split(':').slice(1).join(':') : e.model;
  const p = prices[modelId];
  if (!p) return 0;
  return (e.inputTokens / 1000) * p.inputPer1K + (e.outputTokens / 1000) * p.outputPer1K;
}

function computeTotalCostFromEvents(events: WireEvent[], prices: Record<string, ModelPricing> | null): number {
  if (!prices) return 0;
  let total = 0;
  for (const { event } of events) total += computeEventCost(event, prices);
  return total;
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
  /** Running token cost for the current live session (resets on session switch). */
  sessionCostUsd: number;
  /** Real-time cost estimate for in-flight LLM turns (updates every llm_progress ~250ms). */
  sessionCostInflight: number;
  /** Per-model pricing loaded from /api/prices/azure. */
  prices: Record<string, ModelPricing> | null;

  // ─── Multi-session / project state ─────────────────────────────────────────
  projects: Project[];
  activeProjectId: string | null;
  sessions: SessionMeta[];
  activeSessionId: string | null;

  // ─── UI panel state ───────────────────────────────────────────────────────────
  devPanelOpen: boolean;
  sidebarOpen: boolean;

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
  // multi-session / project actions
  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (id: string | null) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setPrices: (p: Record<string, ModelPricing>) => void;
  resetSession: () => void;
  // UI panel actions
  setDevPanelOpen: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
}

function recomputeReplayModel(events: WireEvent[], cursor: number): SessionModel {
  const slice = events.slice(0, cursor);
  return buildModel(slice);
}

// Module-level ephemeral tracker for in-flight LLM turns (not persisted in state).
// Keyed by nodeId ?? context — unique per concurrent turn.
const _inflightTurns = new Map<string, { model: string; inputChars: number; outputChars: number }>();

function computeInflightCost(prices: Record<string, ModelPricing> | null): number {
  if (!prices || _inflightTurns.size === 0) return 0;
  let total = 0;
  for (const [, turn] of _inflightTurns) {
    if (!turn.model) continue;
    const modelId = turn.model.includes(':') ? turn.model.split(':').slice(1).join(':') : turn.model;
    const p = prices[modelId];
    if (!p) continue;
    total += (turn.inputChars / 4 / 1000) * p.inputPer1K + (turn.outputChars / 4 / 1000) * p.outputPer1K;
  }
  return total;
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
  sessionCostUsd: 0,
  sessionCostInflight: 0,
  prices: null,
  // multi-session / project initial state
  projects: [],
  activeProjectId: null,
  sessions: [],
  activeSessionId: null,
  // UI panel initial state
  devPanelOpen: false,
  sidebarOpen: true,

  feedLive: (events) => {
    const s = get();
    if (s.mode === 'replay') return;
    const m = s.model;
    let autoExpand = s.expanded;
    let mutatedExpand = false;
    let costDelta = 0;
    let inflightChanged = false;
    for (const we of events) {
      applyWireEvent(m, we);
      const ev = we.event;
      costDelta += computeEventCost(ev, s.prices);
      // Track in-flight turns for real-time cost estimate
      if (ev.type === 'llm_request') {
        const key = ev.nodeId ?? ev.context;
        const inputChars = ev.system.length + ev.messages.reduce((acc: number, msg: { content: string }) => acc + msg.content.length, 0);
        _inflightTurns.set(key, { model: ev.model ?? '', inputChars, outputChars: 0 });
        inflightChanged = true;
      } else if (ev.type === 'llm_progress') {
        const key = ev.nodeId ?? ev.context;
        const turn = _inflightTurns.get(key);
        if (turn) { turn.outputChars = ev.chars; inflightChanged = true; }
      } else if (ev.type === 'llm_response') {
        const key = ev.nodeId ?? ev.context;
        _inflightTurns.delete(key);
        inflightChanged = true;
      }
      // Auto-expand running nodes while following
      if (s.follow && ev.type === 'node_start') {
        if (!autoExpand.has(ev.nodeId)) {
          if (!mutatedExpand) { autoExpand = new Set(autoExpand); mutatedExpand = true; }
          autoExpand.add(ev.nodeId);
          if (ev.parentId) autoExpand.add(ev.parentId);
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
    const newInflight = inflightChanged ? computeInflightCost(s.prices) : s.sessionCostInflight;
    set({
      version: s.version + 1,
      ...(mutatedExpand ? { expanded: autoExpand } : {}),
      ...(nextSel !== s.selectedNodeId ? { selectedNodeId: nextSel } : {}),
      ...(costDelta > 0 ? { sessionCostUsd: s.sessionCostUsd + costDelta } : {}),
      ...(inflightChanged ? { sessionCostInflight: newInflight } : {}),
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

  // ─── Multi-session / project actions ──────────────────────────────────────
  setProjects: (projects) => set({ projects }),
  setActiveProjectId: (id) => set({ activeProjectId: id }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  setPrices: (prices) => set({ prices }),
  // ─── UI panel actions ─────────────────────────────────────────────────────
  setDevPanelOpen: (devPanelOpen) => set({ devPanelOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  resetSession: () => {
    _inflightTurns.clear();
    set({
      model: emptyModel(),
      version: 0,
      selectedNodeId: null,
      userSelected: false,
      follow: true,
      expanded: new Set<string>(),
      done: false,
      spaceName: '',
      agentSlug: '',
      replay: null,
      mode: 'live',
      connection: 'connecting',
      sessionCostUsd: 0,
      sessionCostInflight: 0,
    });
  },

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
          // Rebuild the model wholesale from the snapshot (handles connect /
          // resume / reconnect). Unlike live `trace` events (which auto-expand
          // in feedLive as node_start arrives), a snapshot rebuild would otherwise
          // leave `expanded` empty and the tree would render as a single collapsed
          // root row — so auto-expand every node that has children.
          const events = (msg.events as WireEvent[]) ?? [];
          const wireEvents = events.map((x) => ({ seq: x.seq, event: x.event }));
          const rebuilt = buildModel(wireEvents);
          _inflightTurns.clear();
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
}
