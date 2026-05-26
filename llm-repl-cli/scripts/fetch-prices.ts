/**
 * Fetches Azure AI model pricing from the retail prices API and writes
 * prices.json to the package root.
 *
 * Run: pnpm fetch-prices
 *
 * To add a new model, append an entry to MODEL_MAP using the exact SKU names
 * from the Azure retail prices API (Global Standard, swedencentral).
 * SKU names can be found by running this script with --dump to print all items.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REGION = "swedencentral";
const BASE_URL = "https://prices.azure.com/api/retail/prices";
const API_VERSION = "2023-01-01-preview";

// Maps deployment ID → Azure retail price SKU identifiers.
// productName and skuName are matched case-insensitively.
// Use "Glbl" / "glbl" variants (not DZone / regional) for GlobalStandard pricing.
const MODEL_MAP: Record<string, { product: string; inputSku: string; outputSku: string }> = {
  "DeepSeek-V4-Flash": {
    product: "Azure Deepseek Models",
    inputSku: "V4 Flash Inp glbl",
    outputSku: "V4 Flash Outp glbl",
  },
  "DeepSeek-V4-Pro": {
    product: "Azure Deepseek Models",
    inputSku: "V4 Pro Inp glbl",
    outputSku: "V4 Pro Outp glbl",
  },
  "gpt-5.4-mini": {
    product: "Azure OpenAI GPT5",
    inputSku: "GPT 5 Mini Inpt Glbl",
    outputSku: "GPT 5 Mini outpt Glbl",
  },
  "gpt-5.4": {
    product: "Azure OpenAI GPT5",
    inputSku: "GPT 5 Chat Inpt Glbl",
    outputSku: "GPT 5 Chat outpt Glbl",
  },
  "grok-4-1-fast-reasoning": {
    product: "Azure Grok Models",
    inputSku: "Grok 4.1 Inp Glbl",
    outputSku: "Grok 4.1 Outp Glbl",
  },
  "gpt-4.1-mini": {
    product: "Azure OpenAI",
    inputSku: "gpt-4.1-mini-ft input global",
    outputSku: "gpt-4.1-mini-ft output global",
  },
  "Kimi-K2.6": {
    product: "Azure Kimi",
    inputSku: "K2.6 Thinking Inp glbl",
    outputSku: "K2.6 Thinking Outp glbl",
  },
  "DeepSeek-R1-0528": {
    product: "Azure Deepseek Models",
    inputSku: "R1 Inp glbl",
    outputSku: "R1 Outp glbl",
  },
};

interface PriceItem {
  productName: string;
  skuName: string;
  retailPrice: number;
  unitOfMeasure: string;
}

export interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
}

async function fetchAllPrices(): Promise<PriceItem[]> {
  const filter = `armRegionName eq '${REGION}' and serviceFamily eq 'AI + Machine Learning'`;
  let url: string | null =
    `${BASE_URL}?api-version=${API_VERSION}&$filter=${encodeURIComponent(filter)}`;

  const all: PriceItem[] = [];
  let page = 0;
  while (url) {
    page++;
    process.stdout.write(`  page ${page}…\r`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from prices API`);
    const data = (await resp.json()) as { Items: PriceItem[]; NextPageLink?: string };
    all.push(...data.Items);
    url = data.NextPageLink ?? null;
  }
  process.stdout.write(`\n`);
  return all;
}

function findPrice(
  items: PriceItem[],
  product: string,
  sku: string,
): number | null {
  const p = product.toLowerCase();
  const s = sku.toLowerCase();
  const item = items.find(
    (i) =>
      i.productName.toLowerCase() === p &&
      i.skuName.toLowerCase() === s,
  );
  return item?.retailPrice ?? null;
}

/** Convert any per-unit price to per-1K tokens. */
function normalizeTo1K(price: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.includes("1k") || u === "1 k") return price;
  if (u.includes("1m") || u === "1m tokens") return price / 1000;
  // Default: assume price is already per-1K
  return price;
}

async function main(): Promise<void> {
  const dump = process.argv.includes("--dump");

  console.log(`Fetching Azure AI pricing (${REGION})…`);
  const items = await fetchAllPrices();
  console.log(`Fetched ${items.length} price items.`);

  if (dump) {
    const aiItems = items.filter((i) =>
      ["Azure Deepseek Models", "Azure Grok Models", "Azure Kimi",
       "Azure OpenAI GPT5", "Azure OpenAI", "Azure Fireworks Models",
       "Azure Anthropic Models"].includes(i.productName),
    );
    for (const it of aiItems) {
      console.log(`  ${it.productName.padEnd(30)} | ${it.skuName.padEnd(48)} | $${it.retailPrice}/${it.unitOfMeasure}`);
    }
    return;
  }

  const prices: Record<string, ModelPricing> = {};

  for (const [deploymentId, map] of Object.entries(MODEL_MAP)) {
    const rawInput = findPrice(items, map.product, map.inputSku);
    const rawOutput = findPrice(items, map.product, map.outputSku);

    // Find unit of measure for normalisation
    const inpItem = items.find(
      (i) => i.productName.toLowerCase() === map.product.toLowerCase() &&
             i.skuName.toLowerCase() === map.inputSku.toLowerCase(),
    );
    const outItem = items.find(
      (i) => i.productName.toLowerCase() === map.product.toLowerCase() &&
             i.skuName.toLowerCase() === map.outputSku.toLowerCase(),
    );

    if (rawInput !== null && rawOutput !== null) {
      const inputPer1K = normalizeTo1K(rawInput, inpItem?.unitOfMeasure ?? "1K");
      const outputPer1K = normalizeTo1K(rawOutput, outItem?.unitOfMeasure ?? "1K");
      prices[deploymentId] = { inputPer1K, outputPer1K };
      console.log(
        `  ${deploymentId.padEnd(30)} in=$${inputPer1K.toFixed(6)}/1K  out=$${outputPer1K.toFixed(6)}/1K`,
      );
    } else {
      console.warn(
        `  WARNING: no price found for ${deploymentId}` +
        ` (input=${rawInput ?? "MISSING"}, output=${rawOutput ?? "MISSING"})`,
      );
    }
  }

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../prices.json",
  );
  writeFileSync(outPath, JSON.stringify(prices, null, 2) + "\n", "utf-8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
