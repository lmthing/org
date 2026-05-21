/**
 * Checkpoint eval grader.
 *
 * Primary metrics:
 *   1. Checkpoint quality: fraction of risky-op cases where model uses checkpoint() before the operation
 *   2. Rollback success rate: fraction of rollback cases where model correctly calls rollback()
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
  hasCheckpoint: boolean;
  checkpointBeforeRisky: boolean;
  hasRollback: boolean;
  rollbackTarget: string | number | null;
  detail?: string;
}

function hasCheckpointCall(code: string): boolean {
  return /\bcheckpoint\s*\(/.test(code);
}

function hasRollbackCall(code: string): boolean {
  return /\brollback\s*\(/.test(code);
}

function checkpointBeforeFirstAwait(code: string): boolean {
  const checkpointIdx = code.search(/\bcheckpoint\s*\(/);
  if (checkpointIdx === -1) return false;

  const awaitIdx = code.search(/\bawait\s+/);
  if (awaitIdx === -1) return true;

  return checkpointIdx < awaitIdx;
}

function extractRollbackTarget(code: string): string | number | null {
  const labelMatch = /\brollback\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(code);
  if (labelMatch) return labelMatch[1];

  const countMatch = /\brollback\s*\(\s*(\d+)\s*\)/.exec(code);
  if (countMatch) return parseInt(countMatch[1], 10);

  return null;
}

function hasCheckpointBeforeRisky(code: string): boolean {
  const detector = new BoundaryDetector();
  const stmts = detector.feed(code);
  const remainder = detector.flush();
  const allStmts = remainder ? [...stmts, remainder] : stmts;

  let foundCheckpoint = false;
  for (const stmt of allStmts) {
    if (/\bcheckpoint\s*\(/.test(stmt)) {
      foundCheckpoint = true;
    }
    if (
      foundCheckpoint &&
      (/\bawait\s+fetch\s*\(/.test(stmt) ||
        /\bfs\.(writeFile|rm|write)\s*\(/.test(stmt) ||
        /\bawait\s+/.test(stmt))
    ) {
      return true;
    }
  }
  return false;
}

async function runCheckpointCase(
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
    `// ═══ checkpoint eval ═══`,
    ``,
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

  const hasCheckpoint = hasCheckpointCall(code);
  const checkpointBefore = hasCheckpoint && (checkpointBeforeFirstAwait(code) || hasCheckpointBeforeRisky(code));
  const hasRollback = hasRollbackCall(code);
  const rollbackTarget = hasRollback ? extractRollbackTarget(code) : null;

  const expectedCheckpoint = entry.expected['usesCheckpoint'] as boolean ?? false;
  const expectedCheckpointBefore = entry.expected['checkpointBeforeRisky'] as boolean ?? false;
  const expectedRollback = entry.expected['usesRollback'] as boolean ?? false;
  const expectedRollbackTarget = entry.expected['rollbackTarget'] as string | undefined;
  const expectedRollbackCount = entry.expected['rollbackCount'] as number | undefined;

  let pass = true;
  const failReasons: string[] = [];

  if (expectedCheckpoint && !hasCheckpoint) {
    pass = false;
    failReasons.push('missing checkpoint()');
  }
  if (expectedCheckpointBefore && !checkpointBefore) {
    pass = false;
    failReasons.push('checkpoint() not before risky op');
  }
  if (expectedRollback && !hasRollback) {
    pass = false;
    failReasons.push('missing rollback()');
  }
  if (expectedRollbackTarget && rollbackTarget !== expectedRollbackTarget) {
    pass = false;
    failReasons.push(`wrong rollback target: got ${String(rollbackTarget)}, expected ${expectedRollbackTarget}`);
  }
  if (expectedRollbackCount !== undefined && rollbackTarget !== expectedRollbackCount) {
    pass = false;
    failReasons.push(`wrong rollback count: got ${String(rollbackTarget)}, expected ${expectedRollbackCount}`);
  }

  return {
    id: entry.id,
    label: entry.label,
    pass,
    hasCheckpoint,
    checkpointBeforeRisky: checkpointBefore,
    hasRollback,
    rollbackTarget,
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
      result = await runCheckpointCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        hasCheckpoint: false,
        checkpointBeforeRisky: false,
        hasRollback: false,
        rollbackTarget: null,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const checkpointCases = results.filter((r) => {
    const entry = dataset.find((e) => e.id === r.id);
    return entry?.expected['usesCheckpoint'] === true || entry?.expected['checkpointBeforeRisky'] === true;
  });
  const rollbackCases = results.filter((r) => {
    const entry = dataset.find((e) => e.id === r.id);
    return entry?.expected['usesRollback'] === true;
  });

  const checkpointQualityPassed = checkpointCases.filter((r) => r.checkpointBeforeRisky || r.hasCheckpoint).length;
  const rollbackPassed = rollbackCases.filter((r) => r.hasRollback).length;

  const checkpointQuality = checkpointCases.length > 0 ? checkpointQualityPassed / checkpointCases.length : 1;
  const rollbackSuccessRate = rollbackCases.length > 0 ? rollbackPassed / rollbackCases.length : 1;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Checkpoint quality:      ${(checkpointQuality * 100).toFixed(1)}% (${checkpointQualityPassed}/${checkpointCases.length})`);
  console.log(`Rollback success rate:   ${(rollbackSuccessRate * 100).toFixed(1)}% (${rollbackPassed}/${rollbackCases.length})`);
  console.log(`Total cases:             ${total}`);
  console.log(`Model:                   ${options.modelSpec} (${alias})`);
}
