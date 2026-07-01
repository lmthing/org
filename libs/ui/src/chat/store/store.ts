// ─── Chat store — thin composition root ─────────────────────────────────────
// The single Zustand store for the chat surface, assembled from cohesive
// slices (session/replay/pricing/project/ui-panel). See each slice file for
// its concern; this file only wires them together and re-exports the public
// API that previously lived here (same names/signatures — do not remove).

import { create } from 'zustand';
import { createSessionSlice } from './session-slice.js';
import { createReplaySlice } from './replay-slice.js';
import { createPricingSlice } from './pricing-slice.js';
import { createProjectSlice } from './project-slice.js';
import { createUiPanelSlice } from './ui-panel-slice.js';
import { createConnectLive, type UiControl } from './ws-client.js';
import type { AppState } from './types.js';

export const useStore = create<AppState>((set, get) => ({
  ...createSessionSlice(set, get),
  ...createReplaySlice(set, get),
  ...createPricingSlice(set),
  ...createProjectSlice(set),
  ...createUiPanelSlice(set),
}));

// ─── Public API (re-exported for existing consumers of './store.js') ───────

export type { InspectorTab, Mode, Connection, Project, SessionMeta, ModelPricing } from './types.js';
export type { UiControl };
export const connectLive = createConnectLive(useStore);
