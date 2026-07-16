// ─── Session slice ────────────────────────────────────────────────────────────
// Owns the live execution model: connection/mode, the reduced `SessionModel`,
// inspector selection/expansion, and the conversation-block actions
// (user/error/ask). `feedLive` is the hot path — it applies a batch of wire
// events, updates running cost, and auto-selects/expands while following.

import {
  type SessionModel, type WireEvent, type UploadedAttachment, emptyModel, applyWireEvent,
  pushUserBlock, pushErrorBlock, pushAskBlock, resolveAskBlock,
} from './model.js';
import { computeEventCost, computeInflightCost, inflightTurns } from './pricing-slice.js';
import type { AppState, Connection, InspectorTab } from './types.js';

export interface SessionSlice {
  mode: AppState['mode'];
  connection: Connection;
  model: SessionModel;
  version: number;
  selectedNodeId: string | null;
  userSelected: boolean;
  tab: InspectorTab;
  follow: boolean;
  expanded: Set<string>;
  done: boolean;
  spaceName: string;
  agentSlug: string;
  sessionTitle: string;
  activity: string;

  feedLive: (events: WireEvent[]) => void;
  setConnection: (c: Connection) => void;
  setHello: (h: { spaceName: string; agentSlug: string }) => void;
  setSessionTitle: (t: string) => void;
  setDone: (d: boolean) => void;
  selectNode: (id: string | null, byUser?: boolean) => void;
  setTab: (t: InspectorTab) => void;
  toggleExpand: (id: string) => void;
  setExpanded: (id: string, v: boolean) => void;
  setFollow: (f: boolean) => void;
  noteUserMessage: (content: string, attachments?: UploadedAttachment[]) => void;
  noteError: (message: string) => void;
  noteAskStart: (askId: string, descriptor: unknown) => void;
  noteAskEnd: (askId: string, value: unknown, cancelled?: boolean) => void;
  resetSession: () => void;
}

export function createSessionSlice(
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): SessionSlice {
  return {
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
    sessionTitle: '',
    activity: '',

    feedLive: (events) => {
      const s = get();
      if (s.mode === 'replay') return;
      const m = s.model;
      let autoExpand = s.expanded;
      let mutatedExpand = false;
      let costDelta = 0;
      let inflightChanged = false;
      let titleUpdate: string | undefined;
      let activityUpdate: string | undefined;
      for (const we of events) {
        applyWireEvent(m, we);
        const ev = we.event;
        costDelta += computeEventCost(ev, s.prices);
        // The agent named the session — surface the title live in the header + sidebar.
        if (ev.type === 'session_meta' && ev.title) titleUpdate = ev.title;
        // The MAIN "currently doing" line: only the top-level session (THING) scope.
        // Fork/delegate sub-activities are handled by applyWireEvent (they set the
        // work node's narration, shown by WorkBlock — not this header line).
        else if (ev.type === 'activity' && ev.scope === 'session') activityUpdate = ev.text;
        // Track in-flight turns for real-time cost estimate
        if (ev.type === 'llm_request') {
          const key = ev.nodeId ?? ev.context;
          const inputChars = ev.system.length + ev.messages.reduce((acc: number, msg: { content: string }) => acc + msg.content.length, 0);
          inflightTurns.set(key, { model: ev.model ?? '', inputChars, outputChars: 0 });
          inflightChanged = true;
        } else if (ev.type === 'llm_progress') {
          const key = ev.nodeId ?? ev.context;
          const turn = inflightTurns.get(key);
          if (turn) { turn.outputChars = ev.chars; inflightChanged = true; }
        } else if (ev.type === 'llm_response') {
          const key = ev.nodeId ?? ev.context;
          inflightTurns.delete(key);
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
        ...(titleUpdate !== undefined ? { sessionTitle: titleUpdate } : {}),
        ...(activityUpdate !== undefined ? { activity: activityUpdate } : {}),
      });
    },

    setConnection: (connection) => set({ connection }),
    setHello: (h) => set({ spaceName: h.spaceName, agentSlug: h.agentSlug }),
    setSessionTitle: (sessionTitle) => set({ sessionTitle }),
    // Turn went idle → clear the live "currently doing" lines (both main + any
    // stragglers). setDone(false) on a new turn leaves them alone.
    setDone: (done) => set(done ? { done, activity: '' } : { done }),
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

    noteUserMessage: (content, attachments) => set((s) => { pushUserBlock(s.model, content, attachments); return { version: s.version + 1, done: false }; }),
    noteError: (message) => set((s) => { pushErrorBlock(s.model, message); return { version: s.version + 1 }; }),
    noteAskStart: (askId, descriptor) => set((s) => { pushAskBlock(s.model, askId, descriptor); return { version: s.version + 1 }; }),
    noteAskEnd: (askId, value, cancelled) => set((s) => { resolveAskBlock(s.model, askId, value, cancelled); return { version: s.version + 1 }; }),

    resetSession: () => {
      inflightTurns.clear();
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
        sessionTitle: '',
        activity: '',
        replay: null,
        mode: 'live',
        connection: 'connecting',
        sessionCostUsd: 0,
        sessionCostInflight: 0,
      });
    },
  };
}
