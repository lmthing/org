/**
 * Snapshot eval grader.
 *
 * Primary metric: cross-session scope reuse rate —
 *   fraction where model correctly uses variables from base snapshot
 *   without redeclaring them.
 *
 * Secondary metric: skip-path rebuild rate —
 *   fraction where model correctly rebuilds variables when snapshot
 *   is unavailable (heap > 64MB).
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
    return readFile(join(__dirname, 'prompts', 'l.md'), 'utf8');
  }
}

interface CaseResult {
  id: string;
  label: string;
  pass: boolean;
  reusesBaseVar: boolean;
  redeclares: boolean;
  rebuildsVar: boolean;
  usesInspect: boolean;
  noRollbackToSkipped: boolean;
  detail?: string;
}

function hasRedeclaration(code: string, scope: Record<string, unknown>): boolean {
  for (const key of Object.keys(scope)) {
    if (new RegExp(`\\b(?:const|let|var)\\s+${key}\\b`).test(code)) {
      return true;
    }
  }
  return false;
}

function usesBaseVar(code: string, scope: Record<string, unknown>): boolean {
  for (const key of Object.keys(scope)) {
    if (new RegExp(`\\b${key}\\b`).test(code)) {
      return true;
    }
  }
  return Object.keys(scope).length === 0; // vacuously true if no scope vars
}

function hasInspectCall(code: string): boolean {
  return /\binspect\s*\(/.test(code);
}

function hasDeclaration(code: string): boolean {
  return /\b(?:const|let|var)\s+\w+/.test(code);
}

function hasRollbackToRef(code: string, ref: string): boolean {
  return new RegExp(`rollback\\s*\\(\\s*['"\`]${ref}['"\`]\\s*\\)`).test(code);
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

async function runSnapshotCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const scope = (entry.input['scope'] as Record<string, unknown>) ?? {};
  const task = (entry.input['task'] as string) ?? entry.description;
  const heapSkipped = entry.input['heapSkipped'] === true;
  const baseSnapshotHint = entry.input['baseSnapshotHint'] as string | null | undefined;
  const skippedRef = entry.input['skippedRef'] as string | undefined;

  const scopeLines = Object.entries(scope)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');

  const contextLines: string[] = [
    `// ═══ snapshot eval ═══`,
    ``,
  ];

  if (heapSkipped) {
    contextLines.push(`// NOTE: heap snapshot was skipped (heap > 64MB) — no prior variables available`);
  } else if (baseSnapshotHint) {
    contextLines.push(`// NOTE: base snapshot loaded — ${baseSnapshotHint}`);
  }

  if (scopeLines) {
    contextLines.push(treeBlock('__scope', scopeLines.replace(/^\s{2}/gm, '')));
  }

  contextLines.push(`// User: ${task}`);

  const userTurn = contextLines.filter(Boolean).join('\n');

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const code = stripFences(text.trim());

  const expectedReusesBase = entry.expected['reusesBaseVar'] === true;
  const expectedRedeclares = entry.expected['redeclares'] === true;
  const expectedRebuildsVar = entry.expected['rebuildsVar'] === true;
  const expectedUsesInspect = entry.expected['usesInspect'] === true;
  const expectedNoRollbackToSkipped = entry.expected['noRollbackToSkipped'] === true;

  const reusesBaseVar = usesBaseVar(code, scope);
  const redeclares = hasRedeclaration(code, scope);
  const rebuildsVar = hasDeclaration(code);
  const usesInspect = hasInspectCall(code);
  const noRollbackToSkipped = skippedRef ? !hasRollbackToRef(code, skippedRef) : true;

  let pass = true;
  const failReasons: string[] = [];

  if (expectedReusesBase && !reusesBaseVar) {
    pass = false;
    failReasons.push('expected to reuse base snapshot variable');
  }
  if (expectedRedeclares === false && redeclares) {
    pass = false;
    failReasons.push('should not redeclare base snapshot variable');
  }
  if (expectedRebuildsVar && !rebuildsVar) {
    pass = false;
    failReasons.push('expected to rebuild variable declaration');
  }
  if (expectedUsesInspect && !usesInspect) {
    pass = false;
    failReasons.push('missing inspect()');
  }
  if (expectedNoRollbackToSkipped && !noRollbackToSkipped) {
    pass = false;
    failReasons.push(`should not rollback to skipped ref ${skippedRef}`);
  }

  return {
    id: entry.id,
    label: entry.label,
    pass,
    reusesBaseVar,
    redeclares,
    rebuildsVar,
    usesInspect,
    noRollbackToSkipped,
    detail: failReasons.length > 0 ? failReasons.join('; ') : undefined,
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
      result = await runSnapshotCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        reusesBaseVar: false,
        redeclares: false,
        rebuildsVar: false,
        usesInspect: false,
        noRollbackToSkipped: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;

  const reuseEntries = dataset.filter((e) => e.expected['reusesBaseVar'] === true);
  const reuseResults = results.filter((r) => reuseEntries.some((e) => e.id === r.id));
  const reusePassedCount = reuseResults.filter((r) => r.reusesBaseVar && !r.redeclares).length;

  const skipEntries = dataset.filter((e) => e.expected['rebuildsVar'] === true);
  const skipResults = results.filter((r) => skipEntries.some((e) => e.id === r.id));
  const skipPassedCount = skipResults.filter((r) => r.rebuildsVar).length;

  const reuseRate = reuseEntries.length > 0 ? reusePassedCount / reuseEntries.length : 1;
  const skipRebuildRate = skipEntries.length > 0 ? skipPassedCount / skipEntries.length : 1;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Pass rate:               ${(passed / total * 100).toFixed(1)}% (${passed}/${total})`);
  console.log(`Cross-session reuse:     ${(reuseRate * 100).toFixed(1)}% (${reusePassedCount}/${reuseEntries.length})`);
  console.log(`Skip-path rebuild rate:  ${(skipRebuildRate * 100).toFixed(1)}% (${skipPassedCount}/${skipEntries.length})`);
  console.log(`Model:                   ${options.modelSpec} (${alias})`);
}
