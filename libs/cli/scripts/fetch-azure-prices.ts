/**
 * Fetch Azure AI Foundry per-token prices and write them to prices/azure.json.
 *
 * The public Azure Retail Prices API (https://prices.azure.com/api/retail/prices)
 * needs no auth. We query the token meters for each enabled model and normalise the
 * retail price to a per-1K-token USD figure (`inputPer1K` / `outputPer1K`) — the shape
 * consumed by src/server/session-manager.ts and served at /api/prices/azure.
 *
 * The result is the BASE (Azure) price. The 15% gateway markup is applied separately
 * when generating the LiteLLM model_list (see cloud/scripts/generate-litellm-models.ts).
 *
 * Idempotent: existing entries are preserved when a model isn't found in the feed
 * (we warn instead of zeroing). Run:
 *   pnpm fetch-azure-prices     # (from libs/cli)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRICES_PATH = join(dirname(fileURLToPath(import.meta.url)), '../prices/azure.json');
const RETAIL_API = 'https://prices.azure.com/api/retail/prices';

interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
}

/**
 * One target model. `meter` substrings identify the input/output token meters in the
 * retail feed (matched case-insensitively against `meterName`). `fallback` seeds a
 * value when the model is absent from the feed AND absent from the current file
 * (e.g. a brand-new deployment not yet in the public price sheet).
 */
interface Target {
  model: string;
  inputMeter: string;
  outputMeter: string;
  fallback?: ModelPricing;
}

const TARGETS: Target[] = [
  { model: 'DeepSeek-V4-Flash', inputMeter: 'DeepSeek-V4-Flash Input', outputMeter: 'DeepSeek-V4-Flash Output' },
  { model: 'DeepSeek-V4-Pro', inputMeter: 'DeepSeek-V4-Pro Input', outputMeter: 'DeepSeek-V4-Pro Output' },
  { model: 'Kimi-K2.6', inputMeter: 'Kimi-K2.6 Input', outputMeter: 'Kimi-K2.6 Output' },
  {
    model: 'gpt-5.5',
    inputMeter: 'gpt-5.5 Input',
    outputMeter: 'gpt-5.5 Output',
    // Placeholder until gpt-5.5 appears on the public Azure price sheet — set to the
    // real Azure list price once known. Flagged loudly in the run output.
    fallback: { inputPer1K: 0.00125, outputPer1K: 0.01 },
  },
];

interface RetailItem {
  meterName: string;
  retailPrice: number;
  unitOfMeasure: string;
  productName?: string;
  serviceName?: string;
}

/** Normalise a retail price to per-1K tokens based on the unit of measure. */
function toPer1K(retailPrice: number, unitOfMeasure: string): number {
  const u = unitOfMeasure.toLowerCase();
  if (u.includes('1m') || u.includes('1,000,000') || u.includes('million')) {
    return retailPrice / 1000; // priced per 1M tokens → per 1K
  }
  if (u.includes('1k') || u.includes('1,000') || u.includes('1000')) {
    return retailPrice; // already per 1K
  }
  // Unknown unit: assume per 1K and warn upstream.
  return retailPrice;
}

async function fetchTokenMeters(model: string): Promise<RetailItem[]> {
  // Filter to Cognitive Services token meters; match the model name in the meter.
  const filter = `serviceName eq 'Cognitive Services' and contains(meterName, '${model}')`;
  const url = `${RETAIL_API}?$filter=${encodeURIComponent(filter)}&$top=200`;
  const items: RetailItem[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next && pages < 10) {
    const res = await fetch(next);
    if (!res.ok) throw new Error(`Retail API ${res.status} for ${model}: ${await res.text()}`);
    const data = (await res.json()) as { Items: RetailItem[]; NextPageLink: string | null };
    items.push(...(data.Items || []));
    next = data.NextPageLink;
    pages += 1;
  }
  return items;
}

function pickPrice(items: RetailItem[], meterSubstr: string): { per1K: number; unit: string } | null {
  const needle = meterSubstr.toLowerCase();
  const hit = items.find((i) => i.meterName.toLowerCase().includes(needle));
  if (!hit) return null;
  return { per1K: toPer1K(hit.retailPrice, hit.unitOfMeasure), unit: hit.unitOfMeasure };
}

async function main() {
  console.log('Azure AI Foundry price fetch → prices/azure.json\n');

  const current: Record<string, ModelPricing> = JSON.parse(readFileSync(PRICES_PATH, 'utf8'));
  const next: Record<string, ModelPricing> = { ...current };
  const warnings: string[] = [];

  for (const t of TARGETS) {
    let items: RetailItem[] = [];
    try {
      items = await fetchTokenMeters(t.model);
    } catch (err) {
      warnings.push(`${t.model}: retail API error — ${(err as Error).message}`);
    }

    const input = pickPrice(items, t.inputMeter);
    const output = pickPrice(items, t.outputMeter);

    if (input && output) {
      next[t.model] = { inputPer1K: input.per1K, outputPer1K: output.per1K };
      console.log(
        `  ${t.model}: in $${input.per1K}/1K (${input.unit}), out $${output.per1K}/1K (${output.unit})`,
      );
    } else if (current[t.model]) {
      warnings.push(`${t.model}: not found in feed — kept existing value`);
      console.log(`  ${t.model}: kept existing (in $${current[t.model].inputPer1K}/1K)`);
    } else if (t.fallback) {
      next[t.model] = t.fallback;
      warnings.push(
        `${t.model}: not in feed and no existing value — seeded PLACEHOLDER fallback, set the real Azure price manually`,
      );
      console.log(`  ${t.model}: seeded placeholder (in $${t.fallback.inputPer1K}/1K)`);
    } else {
      warnings.push(`${t.model}: not found in feed and no fallback — left missing`);
    }
  }

  writeFileSync(PRICES_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`\nWrote ${PRICES_PATH}`);

  if (warnings.length) {
    console.log('\n⚠️  Warnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
