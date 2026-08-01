// ─── Shared types for the chat store (composed from session/replay/pricing/
// project/ui-panel slices in this folder). Kept in one file so every slice
// can share a single `AppState` shape without circular runtime imports. ────

import type { SessionModel, WireEvent, UploadedAttachment } from './model';

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

export interface ReplayState {
  events: WireEvent[];
  cursor: number;       // index into events (exclusive upper bound applied)
  playing: boolean;
  speed: number;
}

export interface ModelPricing { inputPer1K: number; outputPer1K: number }

export interface AppState {
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
  /** Live session title, set by the agent via setSessionMeta() (resets on session switch). */
  sessionTitle: string;
  /** Live "currently doing" status (THING's main line), set via setActivity() from the
   *  top-level session scope. '' = none. Clears when the turn goes idle (setDone) and on
   *  session switch/reset. Fork/delegate sub-activities live on their execution node
   *  (`ExecNode.activity`), not here — `StatusLine` (the sentence above the composer)
   *  prefers a running sub-agent's sentence over this one while work is in flight. */
  activity: string;
  /** Set by `Message`'s "Edit" action to reopen a sent user message in the composer for
   *  edit-and-resend. Consumed once (`Composer`'s `editDraft` effect) then cleared — see
   *  `startEditMessage`/`clearEditDraft`/`truncateFromBlock`. */
  editDraft: { blockId: string; content: string } | null;
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
  /** True when a budget window is exhausted (0% left) — the composer blocks sends. */
  budgetBlocked: boolean;

  // actions
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
  /** Reopen a sent user message (identified by its `ConvoBlock.id`) in the composer. */
  startEditMessage: (blockId: string, content: string) => void;
  /** Consume `editDraft` after the composer has applied it. */
  clearEditDraft: () => void;
  /** Drop `blockId` and every block after it from the LOCAL transcript (edit-and-resend's
   *  "no stale answer under an edited question" cleanup — see `Composer.handleSend`). A no-op
   *  if the block is no longer present. */
  truncateFromBlock: (blockId: string) => void;
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
  setBudgetBlocked: (v: boolean) => void;
}
