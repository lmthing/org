// ─── Pricing / cost-tracking slice ───────────────────────────────────────────
// Owns `prices`, `sessionCostUsd`, `sessionCostInflight` plus the pure cost
// math used by both the session slice (feedLive) and the WS client
// (trace_snapshot rebuild).

import type { TraceEvent } from '@lmthing/core';
import type { WireEvent } from './model';
import type { AppState, ModelPricing } from './types';

export function computeEventCost(ev: TraceEvent, prices: Record<string, ModelPricing> | null): number {
  if (!prices || ev.type !== 'llm_response') return 0;
  const e = ev as { type: 'llm_response'; model?: string; inputTokens?: number; outputTokens?: number };
  if (!e.model || typeof e.inputTokens !== 'number' || typeof e.outputTokens !== 'number') return 0;
  const modelId = e.model.includes(':') ? e.model.split(':').slice(1).join(':') : e.model;
  const p = prices[modelId];
  if (!p) return 0;
  return (e.inputTokens / 1000) * p.inputPer1K + (e.outputTokens / 1000) * p.outputPer1K;
}

export function computeTotalCostFromEvents(events: WireEvent[], prices: Record<string, ModelPricing> | null): number {
  if (!prices) return 0;
  let total = 0;
  for (const { event } of events) total += computeEventCost(event, prices);
  return total;
}

// Module-level ephemeral tracker for in-flight LLM turns (not persisted in state).
// Keyed by nodeId ?? context — unique per concurrent turn.
export const inflightTurns = new Map<string, { model: string; inputChars: number; outputChars: number }>();

export function computeInflightCost(prices: Record<string, ModelPricing> | null): number {
  if (!prices || inflightTurns.size === 0) return 0;
  let total = 0;
  for (const [, turn] of inflightTurns) {
    if (!turn.model) continue;
    const modelId = turn.model.includes(':') ? turn.model.split(':').slice(1).join(':') : turn.model;
    const p = prices[modelId];
    if (!p) continue;
    total += (turn.inputChars / 4 / 1000) * p.inputPer1K + (turn.outputChars / 4 / 1000) * p.outputPer1K;
  }
  return total;
}

export interface PricingSlice {
  prices: Record<string, ModelPricing> | null;
  sessionCostUsd: number;
  sessionCostInflight: number;
  setPrices: (p: Record<string, ModelPricing>) => void;
}

export function createPricingSlice(
  set: (partial: Partial<AppState>) => void,
): PricingSlice {
  return {
    prices: null,
    sessionCostUsd: 0,
    sessionCostInflight: 0,
    setPrices: (prices) => set({ prices }),
  };
}
