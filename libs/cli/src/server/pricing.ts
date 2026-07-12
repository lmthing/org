import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Per-1K input/output USD rates for a model, loaded from `prices/azure.json`. */
export interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
}

/** Load the per-model price table shipped alongside the CLI. Best-effort — an
 *  absent/corrupt file yields an empty table (cost then computes to 0). */
export function loadAzurePrices(): Record<string, ModelPricing> {
  try {
    const pricesPath = join(dirname(fileURLToPath(import.meta.url)), '../prices/azure.json');
    return JSON.parse(readFileSync(pricesPath, 'utf8')) as Record<string, ModelPricing>;
  } catch {
    return {};
  }
}

/** USD cost of one LLM turn given its token counts. Mirrors the client-side
 *  `computeEventCost` formula (input/output per-1K). A `provider:modelId` string
 *  is reduced to its `modelId`; an unknown/absent model costs 0. */
export function computeTurnCost(
  prices: Record<string, ModelPricing>,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!model) return 0;
  const modelId = model.includes(':') ? model.split(':').slice(1).join(':') : model;
  const p = prices[modelId];
  if (!p) return 0;
  return (inputTokens / 1000) * p.inputPer1K + (outputTokens / 1000) * p.outputPer1K;
}
