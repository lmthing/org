// ─── UI panel slice ───────────────────────────────────────────────────────────
// Owns purely presentational chrome toggles (dev panel / sidebar visibility).

import type { AppState } from './types';

export interface UiPanelSlice {
  devPanelOpen: boolean;
  sidebarOpen: boolean;
  budgetBlocked: boolean;
  setDevPanelOpen: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setBudgetBlocked: (v: boolean) => void;
}

export function createUiPanelSlice(
  set: (partial: Partial<AppState>) => void,
): UiPanelSlice {
  return {
    devPanelOpen: false,
    sidebarOpen: true,
    budgetBlocked: false,

    setDevPanelOpen: (devPanelOpen) => set({ devPanelOpen }),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    setBudgetBlocked: (budgetBlocked) => set({ budgetBlocked }),
  };
}
