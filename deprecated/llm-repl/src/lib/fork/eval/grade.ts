/**
 * Fork eval grader.
 *
 * Primary metrics:
 *   1. Fork success rate: fraction of fork cases where model correctly calls resolve() inside fork
 *   2. Budget overrun rate: fraction where fork token budget is exceeded without resolving
 */
import { generateText } from 'ai';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoundaryDetector } from '../../sandbox/boundary.js';

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
    return readFile(join(__dirname, 'prompts', 's.md'), 'utf8');
  }
}

interface CaseResult {
  id: string;
  label: string;
  pass: boolean;
  hasFork: boolean;
  hasResolve: boolean;
  hasInspect: boolean;
  noCodeAfterResolve: boolean;
  checksBudget: boolean;
  detail?: string;
}

function hasForkCall(code: string): boolean {
  return /\bfork\s*\(/.test(code);
}

function hasResolveCall(code: string): boolean {
  return /\bresolve\s*\(/.test(code);
}

function hasInspectCall(code: string): boolean {
  return /\binspect\s*\(/.test(code);
}

function checksBudgetNearingLimit(code: string): boolean {
  return /budget\s*\(\s*\)\s*\.nearingLimit/.test(code) ||
    /nearingLimit/.test(code);
}

function detectNoCodeAfterResolve(code: string): boolean {
  // Find the last resolve() call
  const resolveRe = /\bresolve\s*\([^)]*\)\s*;?/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = resolveRe.exec(code)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) return true; // no resolve found, vacuously true

  const afterResolve = code.slice(lastMatch.index + lastMatch[0].length).trim();
  if (!afterResolve) return true;

  // Use BoundaryDetector to check for complete statements after resolve()
  const detector = new BoundaryDetector();
  const stmts = detector.feed(afterResolve);
  const remainder = detector.flush();
  return stmts.length === 0 && (remainder === null || remainder.trim().length === 0);
}

function commentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `// ${line}` : '//'))
    .join('\n');
}

function indentBlock(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${pad}${line}` : ''))
    .join('\n');
}

function treeBlock(label: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return commentBlock(`  ${label}`);
  return commentBlock(`  ${label}\n${indentBlock(body, 2)}`);
}

async function runForkCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const sessionTs = entry.input['sessionTs'] as string ?? '';
  const scope = entry.input['scope'] as Record<string, unknown> ?? {};
  const task = entry.input['task'] as string ?? entry.description;

  const scopeLines = Object.entries(scope)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');

  const budgetBlock = treeBlock(
    '__budget',
    [
      `tokensUsed: 0`,
      `tokensRemaining: 8000`,
      `inspectCount: 0`,
      `nearingLimit: false`,
      `forksActive: 0`,
      `forksCompleted: 0`,
      `context: { used: 0, max: 8000, scopeTokens: 0, sourceTokens: 0, wastedOnAbort: 0 }`,
      `execution: { statementsTotal: 0, statementsSinceInspect: 0, heapMB: 0, heapMaxMB: 64 }`,
    ].join('\n'),
  );
  const scopeBlock = treeBlock(
    '__scope',
    scopeLines ? scopeLines.replace(/^\s{2}/gm, '') : '',
  );

  const userTurn = [
    `// ═══ fork eval ═══`,
    ``,
    budgetBlock,
    scopeBlock,
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

  const hasFork = hasForkCall(code);
  const hasResolve = hasResolveCall(code);
  const hasInspect = hasInspectCall(code);
  const noCodeAfterResolve = detectNoCodeAfterResolve(code);
  const checksBudget = checksBudgetNearingLimit(code);

  const expectedHasFork = entry.expected['hasFork'] as boolean ?? false;
  const expectedHasResolve = entry.expected['hasResolve'] as boolean ?? false;
  const expectedHasInspect = entry.expected['hasInspect'] as boolean ?? false;
  const expectedNoCodeAfterResolve = entry.expected['noCodeAfterResolve'] as boolean ?? false;
  const expectedChecksBudget = entry.expected['checksBudget'] as boolean ?? false;

  const failReasons: string[] = [];
  if (expectedHasFork && !hasFork) failReasons.push('missing fork()');
  if (expectedHasResolve && !hasResolve) failReasons.push('missing resolve()');
  if (expectedHasInspect && !hasInspect) failReasons.push('missing inspect()');
  if (expectedNoCodeAfterResolve && !noCodeAfterResolve) failReasons.push('code after resolve()');
  if (expectedChecksBudget && !checksBudget) failReasons.push('does not check budget().nearingLimit');

  const pass = failReasons.length === 0;

  return {
    id: entry.id,
    label: entry.label,
    pass,
    hasFork,
    hasResolve,
    hasInspect,
    noCodeAfterResolve,
    checksBudget,
    detail: failReasons.length > 0 ? failReasons.join('; ') : undefined,
  };
}

function stripFences(text: string): string {
  return text
    .replace(/^```typescript\n?/m, '')
    .replace(/^```ts\n?/m, '')
    .replace(/^```\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
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
      result = await runForkCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        hasFork: false,
        hasResolve: false,
        hasInspect: false,
        noCodeAfterResolve: false,
        checksBudget: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;

  // Fork success rate: cases that expected resolve() and got it
  const forkCases = results.filter((r) => {
    const entry = dataset.find((e) => e.id === r.id);
    return entry?.expected['hasFork'] === true || entry?.expected['hasResolve'] === true;
  });
  const forkResolvePassed = forkCases.filter((r) => r.hasResolve).length;
  const forkSuccessRate = forkCases.length > 0 ? forkResolvePassed / forkCases.length : 1;

  // Budget overrun rate: cases with budget check expected but missing
  const budgetCases = results.filter((r) => {
    const entry = dataset.find((e) => e.id === r.id);
    return entry?.expected['checksBudget'] === true;
  });
  const budgetOverrunCount = budgetCases.filter((r) => !r.checksBudget).length;
  const budgetOverrunRate = budgetCases.length > 0 ? budgetOverrunCount / budgetCases.length : 0;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Fork success rate:    ${(forkSuccessRate * 100).toFixed(1)}% (${forkResolvePassed}/${forkCases.length})`);
  console.log(`Budget overrun rate:  ${(budgetOverrunRate * 100).toFixed(1)}% (${budgetOverrunCount}/${budgetCases.length})`);
  console.log(`Total cases:          ${total}`);
  console.log(`Model:                ${options.modelSpec} (${alias})`);
}
