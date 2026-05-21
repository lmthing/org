/**
 * Inspect eval grader.
 *
 * Primary metrics:
 *   1. Inspect frequency rate: fraction of completions that include inspect()
 *   2. Dead-code-after-inspect rate: fraction where statements appear after inspect()
 *
 * Goal: inspect frequency near 100%, dead-code rate near 0%.
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
    return readFile(join(__dirname, 'prompts', 'm.md'), 'utf8');
  }
}

interface CaseResult {
  id: string;
  label: string;
  pass: boolean;
  hasInspect: boolean;
  deadCode: boolean;
  detail?: string;
}

function hasInspectCall(code: string): boolean {
  return /\binspect\s*\(/.test(code);
}

function hasDeadCodeAfterInspect(code: string): boolean {
  // Find the last inspect() call position
  const inspectRe = /\binspect\s*\([^)]*\)(?:\.options\([^)]*\))?;?/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = inspectRe.exec(code)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) return false;

  const afterInspect = code.slice(lastMatch.index + lastMatch[0].length).trim();
  if (!afterInspect) return false;

  // Use BoundaryDetector to see if any complete statements follow
  const detector = new BoundaryDetector();
  const stmts = detector.feed(afterInspect);
  const remainder = detector.flush();
  return stmts.length > 0 || (remainder !== null && remainder.trim().length > 0);
}

async function runInspectCase(
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

  const userTurn = [
    `// ═══ inspect #1 ═══`,
    ``,
    `const __budget: Budget = { tokensUsed: 0, tokensRemaining: 8000, inspectCount: 0, nearingLimit: false, forksActive: 0, forksCompleted: 0, context: { used: 0, max: 8000, scopeTokens: 0, sourceTokens: 0, wastedOnAbort: 0 }, execution: { statementsTotal: 0, statementsSinceInspect: 0, heapMB: 0, heapMaxMB: 64 } };`,
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
  const hasInspect = hasInspectCall(code);
  const deadCode = hasInspect && hasDeadCodeAfterInspect(code);

  const expectedHasInspect = entry.expected['hasInspect'] as boolean ?? true;
  const expectedNoDeadCode = entry.expected['deadCodeAfterInspect'] === false;

  const pass =
    (!expectedHasInspect || hasInspect) &&
    (!expectedNoDeadCode || !deadCode);

  return {
    id: entry.id,
    label: entry.label,
    pass,
    hasInspect,
    deadCode,
    detail: !hasInspect
      ? 'missing inspect()'
      : deadCode
        ? 'dead code after inspect()'
        : undefined,
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
      result = await runInspectCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        hasInspect: false,
        deadCode: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const withInspect = results.filter((r) => r.hasInspect).length;
  const withDeadCode = results.filter((r) => r.deadCode).length;

  const inspectRate = total > 0 ? withInspect / total : 1;
  const deadCodeRate = total > 0 ? withDeadCode / total : 0;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Inspect frequency rate: ${(inspectRate * 100).toFixed(1)}% (${withInspect}/${total})`);
  console.log(`Dead-code-after rate:   ${(deadCodeRate * 100).toFixed(1)}% (${withDeadCode}/${total})`);
  console.log(`Model:                  ${options.modelSpec} (${alias})`);
}
