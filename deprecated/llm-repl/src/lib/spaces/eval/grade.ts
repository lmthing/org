/**
 * Spaces eval grader.
 *
 * Primary metric: action success rate —
 *   fraction where model correctly uses Space methods (addFunction, read, patch, etc.)
 *
 * Secondary metrics:
 *   - Task completion rate: fraction with inspect()
 *   - Knowledge expansion rate: fraction with addKnowledge* methods
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
  actionCorrect: boolean;
  usesInspect: boolean;
  detail?: string;
}

function hasCall(code: string, method: string): boolean {
  return new RegExp(`\\.${method}\\s*\\(`).test(code) || new RegExp(`\\b${method}\\s*\\(`).test(code);
}

function hasSpaceCurrent(code: string): boolean {
  return /Space\s*\.\s*current\s*\(/.test(code) || /Space\.load\s*\(/.test(code);
}

function hasInspectCall(code: string): boolean {
  return /\binspect\s*\(/.test(code);
}

function hasExpandTrue(code: string): boolean {
  return /expand\s*:\s*true/.test(code);
}

function hasLoadFunction(code: string): boolean {
  return /\.loadFunction\s*\(/.test(code);
}

function hasNoRedeclaration(code: string, spaceFiles: Record<string, string>): boolean {
  // Check that the code doesn't redeclare functions that exist in space files
  for (const content of Object.values(spaceFiles)) {
    const fnMatch = /function\s+(\w+)/.exec(content);
    if (fnMatch) {
      const fnName = fnMatch[1];
      if (new RegExp(`\\b(?:function|const|let|var)\\s+${fnName}\\b`).test(code)) {
        return false;
      }
    }
  }
  return true;
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

async function runSpaceCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const task = (entry.input['task'] as string) ?? entry.description;
  const scope = (entry.input['scope'] as Record<string, unknown>) ?? {};
  const spaceFiles = (entry.input['spaceFiles'] as Record<string, string>) ?? {};

  const scopeLines = Object.entries(scope)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');

  const spaceFilesSection = Object.entries(spaceFiles)
    .map(([path, content]) => `// space file: ${path}\n// ${content}`)
    .join('\n');

  const contextLines: string[] = [`// ═══ spaces eval ═══`, ``];

  if (scopeLines) {
    contextLines.push(treeBlock('__scope', scopeLines.replace(/^\s{2}/gm, '')));
  }

  if (spaceFilesSection) {
    contextLines.push(spaceFilesSection);
  }

  contextLines.push(`// User: ${task}`);

  const userTurn = contextLines.filter(Boolean).join('\n');

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const code = stripFences(text.trim());

  const expected = entry.expected;

  const checks: boolean[] = [];
  const failReasons: string[] = [];

  if (expected['usesSpaceCurrent'] === true) {
    const ok = hasSpaceCurrent(code);
    checks.push(ok);
    if (!ok) failReasons.push('missing Space.current()');
  }
  if (expected['usesAddFunction'] === true) {
    const ok = hasCall(code, 'addFunction');
    checks.push(ok);
    if (!ok) failReasons.push('missing addFunction()');
  }
  if (expected['usesAddViewComponent'] === true) {
    const ok = hasCall(code, 'addViewComponent');
    checks.push(ok);
    if (!ok) failReasons.push('missing addViewComponent()');
  }
  if (expected['usesAddFormComponent'] === true) {
    const ok = hasCall(code, 'addFormComponent');
    checks.push(ok);
    if (!ok) failReasons.push('missing addFormComponent()');
  }
  if (expected['usesRead'] === true) {
    const ok = hasCall(code, 'read');
    checks.push(ok);
    if (!ok) failReasons.push('missing read()');
  }
  if (expected['usesWrite'] === true) {
    const ok = hasCall(code, 'write');
    checks.push(ok);
    if (!ok) failReasons.push('missing write()');
  }
  if (expected['usesPatch'] === true) {
    const ok = hasCall(code, 'patch');
    checks.push(ok);
    if (!ok) failReasons.push('missing patch()');
  }
  if (expected['usesList'] === true) {
    const ok = hasCall(code, 'list');
    checks.push(ok);
    if (!ok) failReasons.push('missing list()');
  }
  if (expected['usesRemove'] === true) {
    const ok = hasCall(code, 'remove');
    checks.push(ok);
    if (!ok) failReasons.push('missing remove()');
  }
  if (expected['usesLoadFunction'] === true) {
    const ok = hasLoadFunction(code);
    checks.push(ok);
    if (!ok) failReasons.push('missing loadFunction()');
  }
  if (expected['usesExpandTrue'] === true) {
    const ok = hasExpandTrue(code);
    checks.push(ok);
    if (!ok) failReasons.push('missing { expand: true }');
  }
  if (expected['usesAddAgent'] === true) {
    const ok = hasCall(code, 'addAgent');
    checks.push(ok);
    if (!ok) failReasons.push('missing addAgent()');
  }
  if (expected['usesAddKnowledgeDomain'] === true) {
    const ok = hasCall(code, 'addKnowledgeDomain');
    checks.push(ok);
    if (!ok) failReasons.push('missing addKnowledgeDomain()');
  }
  if (expected['usesAddKnowledgeField'] === true) {
    const ok = hasCall(code, 'addKnowledgeField');
    checks.push(ok);
    if (!ok) failReasons.push('missing addKnowledgeField()');
  }
  if (expected['noRedeclaration'] === true && Object.keys(spaceFiles).length > 0) {
    const ok = hasNoRedeclaration(code, spaceFiles);
    checks.push(ok);
    if (!ok) failReasons.push('redeclared existing space function (contract error)');
  }

  const usesInspect = hasInspectCall(code);
  if (expected['usesInspect'] === true) {
    checks.push(usesInspect);
    if (!usesInspect) failReasons.push('missing inspect()');
  }

  const actionCorrect = checks.length === 0 || checks.every(Boolean);
  const pass = actionCorrect;

  return {
    id: entry.id,
    label: entry.label,
    pass,
    actionCorrect,
    usesInspect,
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
      result = await runSpaceCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        actionCorrect: false,
        usesInspect: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const actionSuccessCount = results.filter((r) => r.actionCorrect).length;
  const taskCompletionCount = results.filter((r) => r.usesInspect).length;

  const knowledgeEntries = dataset.filter(
    (e) => e.expected['usesAddKnowledgeDomain'] === true || e.expected['usesAddKnowledgeField'] === true,
  );
  const knowledgeResults = results.filter((r) => knowledgeEntries.some((e) => e.id === r.id));
  const knowledgePassedCount = knowledgeResults.filter((r) => r.pass).length;

  const actionSuccessRate = total > 0 ? actionSuccessCount / total : 1;
  const taskCompletionRate = total > 0 ? taskCompletionCount / total : 1;
  const knowledgeExpansionRate =
    knowledgeEntries.length > 0 ? knowledgePassedCount / knowledgeEntries.length : 1;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Pass rate:               ${(passed / total * 100).toFixed(1)}% (${passed}/${total})`);
  console.log(`Action success rate:     ${(actionSuccessRate * 100).toFixed(1)}% (${actionSuccessCount}/${total})`);
  console.log(`Task completion rate:    ${(taskCompletionRate * 100).toFixed(1)}% (${taskCompletionCount}/${total})`);
  console.log(`Knowledge expansion:     ${(knowledgeExpansionRate * 100).toFixed(1)}% (${knowledgePassedCount}/${knowledgeEntries.length})`);
  console.log(`Model:                   ${options.modelSpec} (${alias})`);
}
