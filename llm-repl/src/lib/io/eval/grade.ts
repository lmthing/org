/**
 * IO eval grader.
 *
 * Primary metric: end-to-end task completion rate.
 *   Fraction of cases where the model produces valid fetch/fs/require usage
 *   with proper await and error handling patterns.
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
  detail?: string;
}

function hasFetchCall(code: string): boolean {
  return /\bfetch\s*\(/.test(code);
}

function hasFsReadFile(code: string): boolean {
  return /\bfs\.readFile\s*\(/.test(code);
}

function hasFsWriteFile(code: string): boolean {
  return /\bfs\.writeFile\s*\(/.test(code);
}

function hasFsReadDir(code: string): boolean {
  return /\bfs\.readDir\s*\(/.test(code);
}

function hasFsExists(code: string): boolean {
  return /\bfs\.exists\s*\(/.test(code);
}

function hasFsStat(code: string): boolean {
  return /\bfs\.stat\s*\(/.test(code);
}

function hasRequireCall(code: string): boolean {
  return /\brequire\s*\(/.test(code);
}

function hasAwait(code: string): boolean {
  return /\bawait\b/.test(code);
}

function hasTryCatch(code: string): boolean {
  return /\btry\s*\{/.test(code);
}

function hasPermissionErrorRef(code: string): boolean {
  return /PermissionError|permission|kind\s*===?\s*['"]permission['"]/.test(code);
}

function stripFences(text: string): string {
  return text
    .replace(/^```typescript\n?/m, '')
    .replace(/^```ts\n?/m, '')
    .replace(/^```\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}

function commentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `// ${line}` : '//'))
    .join('\n');
}

async function runIoCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const task = entry.input['task'] as string ?? entry.description;

  const budgetBlock = commentBlock(
    `__budget:\n{ tokensUsed: 0, tokensRemaining: 8000, inspectCount: 0, nearingLimit: false, forksActive: 0, forksCompleted: 0, context: { used: 0, max: 8000, scopeTokens: 0, sourceTokens: 0, wastedOnAbort: 0 }, execution: { statementsTotal: 0, statementsSinceInspect: 0, heapMB: 0, heapMaxMB: 64 } }`,
  );
  const scopeBlock = commentBlock(`__scope:\n{}`);
  const userTurn = [
    `// ═══ inspect #1 ═══`,
    ``,
    budgetBlock,
    scopeBlock,
    `// User: ${task}`,
  ].join('\n');

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const code = stripFences(text.trim());
  const expected = entry.expected;

  const failReasons: string[] = [];

  if (expected['hasFetch'] && !hasFetchCall(code)) failReasons.push('missing fetch()');
  if (expected['hasFsReadFile'] && !hasFsReadFile(code)) failReasons.push('missing fs.readFile()');
  if (expected['hasFsWriteFile'] && !hasFsWriteFile(code)) failReasons.push('missing fs.writeFile()');
  if (expected['hasFsReadDir'] && !hasFsReadDir(code)) failReasons.push('missing fs.readDir()');
  if (expected['hasFsExists'] && !hasFsExists(code)) failReasons.push('missing fs.exists()');
  if (expected['hasFsStat'] && !hasFsStat(code)) failReasons.push('missing fs.stat()');
  if (expected['hasRequire'] && !hasRequireCall(code)) failReasons.push('missing require()');
  if (expected['hasAwait'] && !hasAwait(code)) failReasons.push('missing await');
  if (expected['hasTryCatch'] && !hasTryCatch(code)) failReasons.push('missing try/catch');
  if (expected['hasPermissionError'] && !hasPermissionErrorRef(code)) failReasons.push('missing PermissionError handling');

  const pass = failReasons.length === 0;

  return {
    id: entry.id,
    label: entry.label,
    pass,
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
      result = await runIoCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const completionRate = total > 0 ? passed / total : 1;

  const fetchCases = results.filter((_, i) => {
    const e = dataset[i];
    return e !== undefined && Boolean(e.expected['hasFetch']);
  });
  const fsCases = results.filter((_, i) => {
    const e = dataset[i];
    return e !== undefined && (Boolean(e.expected['hasFsReadFile']) || Boolean(e.expected['hasFsWriteFile']));
  });
  const errorCases = results.filter((_, i) => {
    const e = dataset[i];
    return e !== undefined && Boolean(e.expected['hasTryCatch']);
  });

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Completion rate:   ${(completionRate * 100).toFixed(1)}% (${passed}/${total})`);
  console.log(`Fetch cases:       ${fetchCases.filter((r) => r.pass).length}/${fetchCases.length}`);
  console.log(`FS cases:          ${fsCases.filter((r) => r.pass).length}/${fsCases.length}`);
  console.log(`Error handling:    ${errorCases.filter((r) => r.pass).length}/${errorCases.length}`);
  console.log(`Model:             ${options.modelSpec} (${alias})`);
}
