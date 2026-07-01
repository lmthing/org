// ─── Replay slice ─────────────────────────────────────────────────────────────
// Owns `replay` (recorded-events scrubbing state) and its actions. Rebuilds
// `model` from a bounded slice of the recorded events on every seek.

import { buildModel, type SessionModel, type WireEvent } from './model.js';
import type { AppState, ReplayState } from './types.js';

export type { ReplayState };

function recomputeReplayModel(events: WireEvent[], cursor: number): SessionModel {
  const slice = events.slice(0, cursor);
  return buildModel(slice);
}

export interface ReplaySlice {
  replay: ReplayState | null;
  loadReplay: (events: WireEvent[]) => void;
  seek: (cursor: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (s: number) => void;
  exitReplay: () => void;
}

export function createReplaySlice(
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): ReplaySlice {
  return {
    replay: null,

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
  };
}
