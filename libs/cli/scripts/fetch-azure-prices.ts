/**
 * Fetch Azure AI Foundry per-token prices and write them to prices/azure.json.
 *
 * The public Azure Retail Prices API (https://prices.azure.com/api/retail/prices)
 * needs no auth. We query the token meters for each enabled model and normalise the
 * retail price to a per-1K-token USD figure (`inputPer1K` / `outputPer1K` /
 * `cachedInputPer1K`) — the shape consumed by src/server/session-manager.ts and served
 * at /api/prices/azure.
 *
 * The result is the BASE (Azure) price. The 15% gateway markup is applied separately
 * when generating the LiteLLM model_list (see cloud/scripts/generate-litellm-models.ts).
 *
 * Idempotent: existing entries are preserved when a model isn't found in the feed
 * (we warn instead of zeroing). Run:
 *   pnpm fetch-azure-prices     # (from libs/cli)
 *
 * ── Feed quirks this script has to absorb ────────────────────────────────────────
 *
 * `serviceName` is **`Foundry Models`**, NOT `Cognitive Services` — the latter matches
 * zero rows today, which is how an earlier version of this script silently "kept
 * existing value" for every model forever. We therefore do not filter on serviceName
 * at all; we filter on the meter name and validate what comes back.
 *
 * Meter names are not derived from the deployment name and are wildly inconsistent:
 *   FW DeepSeek-V4-Pro Inp DZ Tokens      ← Fireworks-hosted, "Inp"/"Outp"/"Ch Inp"
 *   FW Kimi K2.6 Cache Inp DZ Tokens      ← note the SPACE: "Kimi K2.6", not "Kimi-K2.6"
 *   gpt-4o-0806-Inp-glbl Tokens           ← OpenAI-hosted, hyphenated, dated
 * so each target carries its own `meter` substring rather than reusing `model`.
 *
 * Deployment-SKU variants: a model can publish `glbl` (Global), `DZ` (Data Zone) and
 * `regnl` (Regional) meters at different prices. We take VARIANT_ORDER's first hit, so
 * a GlobalStandard deployment prices at `glbl` where it exists and falls back to `DZ`
 * (the only variant the Fireworks-hosted models publish at all).
 *
 * Not every deployed model is on the public price sheet. gpt-5.x, DeepSeek-V4-Flash and
 * DeepSeek-R1 have NO meter — their prices are maintained by hand (gpt-5.5's came off
 * the EUR list price; see devops/argocd/core/litellm.yaml). Those are declared
 * `manual: true` and reported as such instead of being treated as a fetch failure.
 *
 * whisper and tts are deliberately absent: they are not token-priced (whisper bills per
 * audio hour, tts per minute/character), so they have no place in a per-1K-token map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRICES_PATH = join(dirname(fileURLToPath(import.meta.url)), '../prices/azure.json');
const RETAIL_API = 'https://prices.azure.com/api/retail/prices';

/** Region the meters are read from — the region lmthing-resource lives in. */
const REGION = process.env['AZURE_PRICE_REGION'] ?? 'swedencentral';

/**
 * Deployment-SKU variant preference. Every deployment on lmthing-resource is
 * GlobalStandard, so Global (`glbl` / `Gl`) is the rate that applies; Data Zone and
 * Regional are fallbacks for models that publish no Global meter (e.g. Kimi).
 */
const VARIANT_ORDER = ['glbl', 'dz', 'regnl'] as const;

interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
  /** Prompt-cache read price per 1K tokens. Absent when the model publishes no cache meter. */
  cachedInputPer1K?: number;
}

interface Target {
  model: string;
  /** Exact `productName` in the feed. Scoping by product is REQUIRED — see below. */
  product?: string;
  /** Matches this model's meters within that product (the model name is NOT in the meter). */
  meter?: RegExp;
  /** Not token-priced, so no per-1K figure is meaningful. Never written to the file. */
  notTokenPriced?: string;
}

/**
 * Every model deployed on lmthing-resource.
 *
 * Two traps, both of which produced wrong prices before:
 *
 * 1. **The model name is not in the meter name.** gpt-5.5's meter is `5.5 ShortCo inp Gl
 *    1M Tokens` — no `gpt-` prefix at all; DeepSeek's is `V4 Pro Inp glbl Tokens`. Only
 *    `productName` identifies the family, so every target is scoped by product and matched
 *    on a meter pattern.
 *
 * 2. **The same model is sold under two products at different prices.** DeepSeek-V4-Pro
 *    exists as first-party `Azure Deepseek Models` (`V4 Pro Inp glbl`, $0.00174, Global)
 *    AND as `Azure Fireworks Models` (`FW DeepSeek-V4-Pro Inp DZ`, $0.001925, Data-Zone
 *    only — ~10% dearer). Our deployments are the first-party GlobalStandard ones, so we
 *    pin the product explicitly rather than taking whichever meter matches first.
 *
 * Variant suffixes also differ per family: OpenAI GPT5 uses `Gl`/`Dz` and spells output
 * `opt`; DeepSeek uses `glbl`/`DZ` and spells it `Outp`. `PP` (priority processing) and
 * `Batch` meters price different products and are excluded.
 */
const TARGETS: Target[] = [
  // First-party DeepSeek (Global), NOT the Fireworks-hosted Data-Zone variant.
  { model: 'DeepSeek-V4-Pro', product: 'Azure Deepseek Models', meter: /^V4 Pro / },
  { model: 'DeepSeek-V4-Flash', product: 'Azure Deepseek Models', meter: /^V4 Flash / },
  { model: 'DeepSeek-R1-0528', product: 'Azure Deepseek Models', meter: /^R1 / },
  // Kimi is Fireworks-only: no Global meter exists, so this resolves to Data Zone.
  { model: 'Kimi-K2.6', product: 'Azure Fireworks Models', meter: /^FW Kimi K2\.6 / },
  // GPT-5.x. ShortCo = short-context tier; our agent prompts average ~7K tokens/request,
  // an order of magnitude inside it. LongCo (2x input, 1.5x output) would need a
  // per-request context split the metrics do not expose.
  // `pro` and `longco` are DIFFERENT, far dearer models/tiers that share the `5.4` stem —
  // `5.4 pro opt Gl` is $180/1M against the base `5.4 opt Gl` at $15/1M. Exclude them all.
  { model: 'gpt-5.5', product: 'Azure OpenAI GPT5', meter: /^5\.5 ShortCo (?!PP)/i },
  { model: 'gpt-5.4', product: 'Azure OpenAI GPT5', meter: /^5\.4 (?!nano|mini|pro|longco|shortco)/i },
  { model: 'gpt-5.4-mini', product: 'Azure OpenAI GPT5', meter: /^5\.4 mini (?!pp)/i },
  { model: 'gpt-5.4-nano', product: 'Azure OpenAI GPT5', meter: /^5\.4 nano /i },
  { model: 'gpt-4o', product: 'Azure OpenAI', meter: /^gpt-4o-0806-/ },
  // Billed per audio hour / per character, not per token — a per-1K entry would be a lie.
  { model: 'whisper', notTokenPriced: 'billed per audio hour ($0.36/hr, Speech-to-Text-Batch-Whisper-glbl)' },
  { model: 'tts', notTokenPriced: 'billed per character/minute, not per token' },
];

interface RetailItem {
  meterName: string;
  productName: string;
  retailPrice: number;
  unitOfMeasure: string;
  armRegionName: string;
}

/**
 * Fine-tuning, batch, provisioned and priority-processing meters live alongside the plain
 * inference meters within the same product and would otherwise out-rank them.
 */
const EXCLUDE = /\b(ft|batch|trng|hstng|training|hosting|provisioned|grader|pp)\b|fine|avatar|commit/i;

/** Normalise a retail price to per-1K tokens based on the unit of measure. */
function toPer1K(retailPrice: number, unitOfMeasure: string): number {
  const u = unitOfMeasure.toLowerCase();
  if (u.includes('1m') || u.includes('1,000,000') || u.includes('million')) {
    return retailPrice / 1000; // priced per 1M tokens → per 1K
  }
  return retailPrice; // '1K'
}

/** Every meter in a product family, for our region. Cached across targets sharing a product. */
const productCache = new Map<string, RetailItem[]>();

async function fetchProduct(product: string): Promise<RetailItem[]> {
  const hit = productCache.get(product);
  if (hit) return hit;
  const filter = `productName eq '${product}' and armRegionName eq '${REGION}'`;
  let next: string | null = `${RETAIL_API}?$filter=${encodeURIComponent(filter)}`;
  const items: RetailItem[] = [];
  let pages = 0;
  while (next && pages < 40) {
    const res = await fetch(next);
    if (!res.ok) throw new Error(`Retail API ${res.status} for '${product}': ${await res.text()}`);
    const data = (await res.json()) as { Items: RetailItem[]; NextPageLink: string | null };
    items.push(...(data.Items || []));
    next = data.NextPageLink;
    pages += 1;
  }
  productCache.set(product, items);
  return items;
}

type Kind = 'cached' | 'input' | 'output';

/**
 * Classify a meter as cached-input / input / output. The two families spell these
 * differently — OpenAI GPT5 writes output as `opt` and cached input as `cd inp`, DeepSeek
 * writes `Outp` and `cached`. Cached MUST be tested before input: `cd inp` contains both.
 */
function classify(meterName: string): Kind | null {
  const n = meterName.toLowerCase();
  if (/\bcd\b|\bch\b|\bcache\b|\bcached\b|cchd/.test(n)) return /inp|cached/.test(n) ? 'cached' : null;
  if (/\binp\b|\binput\b/.test(n)) return 'input';
  if (/\boutp\b|\bopt\b|\boutput\b/.test(n)) return 'output';
  return null;
}

/** Which SKU variant a meter prices; `null` when unmarked. GPT5 abbreviates Global to `Gl`. */
function variantOf(meterName: string): string | null {
  const n = meterName.toLowerCase();
  if (/\bglbl\b|\bgl\b|-glbl\b/.test(n)) return 'glbl';
  if (/\bdz\b|\bdzone\b|\bdzn\b/.test(n)) return 'dz';
  if (/\bregnl\b|\brgnl\b/.test(n)) return 'regnl';
  return null;
}

/** Pick the price for `kind`, honouring VARIANT_ORDER; unmarked meters are the last resort. */
function pick(items: RetailItem[], kind: Kind): { per1K: number; meter: string } | null {
  const candidates = items.filter((i) => classify(i.meterName) === kind);
  if (!candidates.length) return null;
  for (const v of [...VARIANT_ORDER, null]) {
    const hit = candidates.find((i) => variantOf(i.meterName) === v);
    if (hit) return { per1K: toPer1K(hit.retailPrice, hit.unitOfMeasure), meter: hit.meterName };
  }
  return null;
}

async function main() {
  console.log(`Azure AI Foundry price fetch (${REGION}) → prices/azure.json\n`);

  const current: Record<string, ModelPricing> = JSON.parse(readFileSync(PRICES_PATH, 'utf8'));
  const next: Record<string, ModelPricing> = { ...current };
  const warnings: string[] = [];

  for (const t of TARGETS) {
    if (t.notTokenPriced) {
      // Deliberately never written to the file: a per-1K number would be fiction.
      delete next[t.model];
      console.log(`  ${t.model}: NOT token-priced — ${t.notTokenPriced}`);
      continue;
    }

    let all: RetailItem[] = [];
    try {
      all = await fetchProduct(t.product!);
    } catch (err) {
      warnings.push(`${t.model}: retail API error — ${(err as Error).message}`);
    }
    const items = all.filter((i) => t.meter!.test(i.meterName) && !EXCLUDE.test(i.meterName));

    const input = pick(items, 'input');
    const output = pick(items, 'output');
    const cached = pick(items, 'cached');

    if (!input || !output) {
      // Loud: silently keeping a stale value is exactly how the old script went wrong.
      warnings.push(
        `${t.model}: no input/output meter matched ${t.meter} under '${t.product}' in ${REGION} ` +
          `(${all.length} product rows) — KEPT existing value. The feed's meter naming may have changed.`,
      );
      console.log(`  ${t.model}: kept existing ⚠️`);
      continue;
    }

    const entry: ModelPricing = { inputPer1K: input.per1K, outputPer1K: output.per1K };
    if (cached) entry.cachedInputPer1K = cached.per1K;
    next[t.model] = entry;

    const prev = current[t.model];
    const delta =
      prev && prev.inputPer1K !== input.per1K
        ? `  (was $${prev.inputPer1K} — ${(input.per1K / prev.inputPer1K).toFixed(2)}×)`
        : prev
          ? ''
          : '  (NEW)';
    console.log(`  ${t.model}: in $${input.per1K}/1K, out $${output.per1K}/1K${delta}`);
    console.log(`      ← ${input.meter} | ${output.meter}`);
    if (cached) console.log(`      cached $${cached.per1K}/1K  ← ${cached.meter}`);
    else warnings.push(`${t.model}: no cache-read meter published — cached tokens will price at the full input rate.`);
  }

  writeFileSync(PRICES_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`\nWrote ${PRICES_PATH}`);

  console.log(
    '\nNote: whisper and tts are intentionally absent — they are not token-priced ' +
      '(whisper bills per audio hour, tts per minute), so no per-1K figure is meaningful.',
  );

  if (warnings.length) {
    console.log('\n⚠️  Warnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
