// ─── Chat store — thin composition root ─────────────────────────────────────
// The single Zustand store for the chat surface, assembled from cohesive
// slices (session/replay/pricing/project/ui-panel). See each slice file for
// its concern; this file only wires them together and re-exports the public
// API that previously lived here (same names/signatures — do not remove).

import { create } from 'zustand';
import { createSessionSlice } from './session-slice';
import { createReplaySlice } from './replay-slice';
import { createPricingSlice } from './pricing-slice';
import { createProjectSlice } from './project-slice';
import { createUiPanelSlice } from './ui-panel-slice';
import { createConnectLive, type UiControl } from './ws-client';
import type { AppState } from './types';

export const useStore = create<AppState>((set, get) => ({
  ...createSessionSlice(set, get),
  ...createReplaySlice(set, get),
  ...createPricingSlice(set),
  ...createProjectSlice(set),
  ...createUiPanelSlice(set),
}));

// ─── Public API (re-exported for existing consumers of './store.js') ───────

export type { InspectorTab, Mode, Connection, Project, SessionMeta, ModelPricing } from './types';
export type { UiControl };
export const connectLive = createConnectLive(useStore);
