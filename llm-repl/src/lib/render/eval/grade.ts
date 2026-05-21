/**
 * Render eval grader.
 *
 * Primary metrics:
 *   - Render correctness: fraction where model uses correct JSX components
 *   - Clarification quality: fraction where ask() is used appropriately for user input
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
    return readFile(join(__dirname, 'prompts', 's.md'), 'utf8');
  }
}

interface CaseResult {
  id: string;
  label: string;
  pass: boolean;
  renderCorrect: boolean;
  clarificationCorrect: boolean;
  detail?: string;
}

function hasDisplayCall(code: string): boolean {
  return /\bdisplay\s*\(/.test(code);
}

function hasAskCall(code: string): boolean {
  return /\bask\s*\(/.test(code);
}

function hasInspectCall(code: string): boolean {
  return /\binspect\s*\(/.test(code);
}

function hasComponent(code: string, name: string): boolean {
  return new RegExp(`<${name}[\\s/>]|\\b${name}\\b`).test(code);
}

function hasStableId(code: string): boolean {
  return /id\s*[:=]\s*['"][^'"]+['"]/.test(code);
}

function hasReplaceMode(code: string): boolean {
  return /mode\s*[:=]\s*['"]replace['"]/.test(code);
}

function hasLoop(code: string): boolean {
  return /\bfor\b|\bwhile\b|\bforEach\b|\bmap\b/.test(code);
}

function noConsoleLog(code: string): boolean {
  return !/\bconsole\.log\s*\(/.test(code);
}

function stripFences(text: string): string {
  return text
    .replace(/^```typescript\n?/m, '')
    .replace(/^```ts\n?/m, '')
    .replace(/^```\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}

function checkRenderCorrect(code: string, expected: Record<string, unknown>): boolean {
  if (expected['hasProgressBar'] && !hasComponent(code, 'ProgressBar')) return false;
  if (expected['hasTable'] && !hasComponent(code, 'Table')) return false;
  if (expected['hasMarkdown'] && !hasComponent(code, 'Markdown')) return false;
  if (expected['hasCodeBlock'] && !hasComponent(code, 'CodeBlock')) return false;
  if (expected['hasTextInput'] && !hasComponent(code, 'TextInput')) return false;
  if (expected['hasSelect'] && !hasComponent(code, 'Select')) return false;
  if (expected['hasConfirm'] && !hasComponent(code, 'Confirm')) return false;
  if (expected['hasDisplay'] && !hasDisplayCall(code)) return false;
  if (expected['hasStableId'] && !hasStableId(code)) return false;
  if (expected['hasReplaceMode'] && !hasReplaceMode(code)) return false;
  if (expected['hasLoop'] && !hasLoop(code)) return false;
  if (expected['noConsoleLog'] && !noConsoleLog(code)) return false;
  return true;
}

function checkClarificationCorrect(code: string, expected: Record<string, unknown>): boolean {
  if (expected['hasAsk'] === true && !hasAskCall(code)) return false;
  if (expected['hasAsk'] === false && hasAskCall(code)) return false;
  if (expected['hasInspect'] && !hasInspectCall(code)) return false;
  return true;
}

async function runRenderCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const task = entry.input['task'] as string ?? entry.description;

  const userTurn = `// User: ${task}\n// Complete the task using display() and ask() as appropriate.`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const code = stripFences(text.trim());
  const renderCorrect = checkRenderCorrect(code, entry.expected);
  const clarificationCorrect = checkClarificationCorrect(code, entry.expected);

  const pass = renderCorrect && clarificationCorrect;
  const failReasons: string[] = [];
  if (!renderCorrect) failReasons.push('wrong/missing JSX components');
  if (!clarificationCorrect) failReasons.push('ask() usage incorrect');

  return {
    id: entry.id,
    label: entry.label,
    pass,
    renderCorrect,
    clarificationCorrect,
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
      result = await runRenderCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        renderCorrect: false,
        clarificationCorrect: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const renderCorrectCount = results.filter((r) => r.renderCorrect).length;
  const clarificationCorrectCount = results.filter((r) => r.clarificationCorrect).length;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Pass rate:               ${(passed / total * 100).toFixed(1)}% (${passed}/${total})`);
  console.log(`Render correctness:      ${(renderCorrectCount / total * 100).toFixed(1)}% (${renderCorrectCount}/${total})`);
  console.log(`Clarification quality:   ${(clarificationCorrectCount / total * 100).toFixed(1)}% (${clarificationCorrectCount}/${total})`);
  console.log(`Model:                   ${options.modelSpec} (${alias})`);
}
