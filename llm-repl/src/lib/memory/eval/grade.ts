/**
 * Memory eval grader.
 *
 * Primary metric: proactive-vs-auto compact ratio
 *   - proactive: model calls compact() before context pressure hits
 *   - auto: autoCompact would trigger (model didn't compact proactively)
 *
 * Score = proactiveCount / totalCompactNeededCases
 */
import { generateText } from 'ai';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const datasetPath = join(__dirname, 'dataset.jsonl');

interface RunOptions {
  lib: string;
  alias: string;
  modelSpec: string;
  model: Parameters<typeof generateText>[0]['model'];
}

interface DatasetEntry {
  id: string;
  label: string;
  description: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

async function loadDataset(): Promise<DatasetEntry[]> {
  const entries: DatasetEntry[] = [];
  const rl = createInterface({ input: createReadStream(datasetPath) });
  for await (const line of rl) {
    if (line.trim()) entries.push(JSON.parse(line) as DatasetEntry);
  }
  return entries;
}

async function loadPrompt(alias: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const name = alias.toLowerCase();
  const promptPath = join(__dirname, 'prompts', `${name}.md`);
  try {
    return await readFile(promptPath, 'utf8');
  } catch {
    return readFile(join(__dirname, 'prompts', 'm.md'), 'utf8');
  }
}

interface CaseResult {
  id: string;
  label: string;
  pass: boolean;
  proactive: boolean;
  wouldAutoCompact: boolean;
  detail?: string;
}

function hasCompactCall(code: string): boolean {
  return /\bcompact\s*\(/.test(code);
}

function hasPinCall(code: string): boolean {
  return /\bpin\s*\(/.test(code);
}

function hasExpandCall(code: string): boolean {
  return /\bexpand\s*\(/.test(code);
}

function stripFences(text: string): string {
  return text
    .replace(/^```typescript\n?/m, '')
    .replace(/^```ts\n?/m, '')
    .replace(/^```\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}

async function runMemoryCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const sessionTs = entry.input['sessionTs'] as string ?? '';
  const scope = entry.input['scope'] as Record<string, unknown> ?? {};
  const budgetInput = entry.input['budget'] as Record<string, unknown> | undefined;
  const task = entry.input['task'] as string ?? entry.description;

  const budgetObj = budgetInput ?? {
    tokensUsed: 4000,
    tokensRemaining: 4000,
    inspectCount: 5,
    nearingLimit: false,
    forksActive: 0,
    forksCompleted: 0,
    context: { used: 4000, max: 8000, scopeTokens: 1000, sourceTokens: 500, wastedOnAbort: 0 },
    execution: { statementsTotal: 20, statementsSinceInspect: 3, heapMB: 12, heapMaxMB: 64 },
  };

  const scopeLines = Object.entries(scope)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');

  const userTurn = [
    `// ═══ inspect #${(budgetObj['inspectCount'] as number) ?? 5} ═══`,
    ``,
    `const __budget: Budget = ${JSON.stringify(budgetObj)};`,
    scopeLines ? `const __scope = {\n${scopeLines}\n};` : `const __scope = {};`,
    sessionTs ? `/* source tail */\n${sessionTs}` : '',
    `// User: ${task}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const code = stripFences(text.trim());
  const expectedHasCompact = entry.expected['hasCompact'] as boolean | undefined;
  const expectedHasPin = entry.expected['hasPin'] as boolean | undefined;
  const expectedHasExpand = entry.expected['hasExpand'] as boolean | undefined;
  const expectedProactive = entry.expected['proactive'] as boolean | undefined;

  const didCompact = hasCompactCall(code);
  const didPin = hasPinCall(code);
  const didExpand = hasExpandCall(code);

  const wouldAutoCompact = expectedProactive === true && !didCompact;
  const isProactive = expectedProactive === true && didCompact;

  let pass = true;
  const failReasons: string[] = [];

  if (expectedHasCompact && !didCompact) {
    pass = false;
    failReasons.push('missing compact()');
  }
  if (expectedHasPin && !didPin) {
    pass = false;
    failReasons.push('missing pin()');
  }
  if (expectedHasExpand && !didExpand) {
    pass = false;
    failReasons.push('missing expand()');
  }

  return {
    id: entry.id,
    label: entry.label,
    pass,
    proactive: isProactive,
    wouldAutoCompact,
    detail: failReasons.length > 0 ? failReasons.join(', ') : undefined,
  };
}

export async function run(options: RunOptions): Promise<void> {
  const { alias, model } = options;
  const dataset = await loadDataset();
  const systemPrompt = await loadPrompt(alias);

  console.log(`Loaded ${dataset.length} eval cases`);

  const results: CaseResult[] = [];

  for (const entry of dataset) {
    process.stdout.write(`  [${entry.id}] ${entry.label} ... `);

    let result: CaseResult;
    try {
      result = await runMemoryCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        proactive: false,
        wouldAutoCompact: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const proactiveCount = results.filter((r) => r.proactive).length;
  const wouldAutoCompactCount = results.filter((r) => r.wouldAutoCompact).length;
  const totalCompactNeeded = proactiveCount + wouldAutoCompactCount;
  const proactiveRatio = totalCompactNeeded > 0 ? proactiveCount / totalCompactNeeded : 1;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Pass rate:                ${(passed / total * 100).toFixed(1)}% (${passed}/${total})`);
  console.log(`Proactive compact ratio:  ${(proactiveRatio * 100).toFixed(1)}% (${proactiveCount}/${totalCompactNeeded})`);
  console.log(`  proactive:              ${proactiveCount}`);
  console.log(`  would-auto-compact:     ${wouldAutoCompactCount}`);
  console.log(`Model:                    ${options.modelSpec} (${alias})`);
}
