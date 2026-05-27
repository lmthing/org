/**
 * Sandbox eval grader.
 *
 * Primary metric: error rate.
 *   Fraction of cases where the model produces code that violates the capture rule
 *   or writes malformed file blocks (when prompted to use them).
 *
 * Tests the model's ability to:
 *   - Write capturable function/class declarations (positive capture rule)
 *   - Avoid non-capturable patterns when instructed (negative capture rule)
 *   - Produce valid TypeScript that compiles cleanly
 */
import { generateText } from 'ai';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCapture } from '../capture.js';
import { BoundaryDetector } from '../boundary.js';

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

/**
 * Ask the model to write a capturable declaration and verify it with analyzeCapture.
 */
async function runCaptureCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const task = entry.description;
  const expectedCapturable = entry.expected['capturable'] as boolean ?? true;
  const expectedKind = entry.expected['kind'] as string | undefined;

  const budgetBlock = treeBlock(
    '__budget',
    [
      `tokensUsed: 0`,
      `tokensRemaining: 8000`,
      `inspectCount: 0`,
      `nearingLimit: false`,
    ].join('\n'),
  );
  const scopeBlock = treeBlock('__scope', '');

  const userTurn = [
    `Reconstruction (inspect #1)`,
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

  const statement = stripFences(text.trim());

  // Extract the first complete statement via BoundaryDetector
  const detector = new BoundaryDetector();
  const stmts = detector.feed(statement);
  const remainder = detector.flush();
  const extracted = stmts[0] ?? remainder ?? statement;

  const decision = analyzeCapture(extracted);

  if (expectedCapturable && !decision.capturable) {
    return {
      id: entry.id,
      label: entry.label,
      pass: false,
      detail: `expected capturable, got: ${(decision as { reason?: string }).reason ?? 'not capturable'}`,
    };
  }

  if (!expectedCapturable && decision.capturable) {
    return {
      id: entry.id,
      label: entry.label,
      pass: false,
      detail: `expected non-capturable, but capture succeeded with kind=${decision.result.kind}`,
    };
  }

  if (expectedKind && decision.capturable && decision.result.kind !== expectedKind) {
    return {
      id: entry.id,
      label: entry.label,
      pass: false,
      detail: `expected kind=${expectedKind}, got kind=${decision.result.kind}`,
    };
  }

  return { id: entry.id, label: entry.label, pass: true };
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
      if (entry.label.includes('capture')) {
        result = await runCaptureCase(entry, model, systemPrompt);
      } else {
        // Non-LLM cases (trace events, boundary detection) — skip in live eval
        result = { id: entry.id, label: entry.label, pass: true, detail: 'skipped (non-LLM case)' };
      }
    } catch (err) {
      result = { id: entry.id, label: entry.label, pass: false, detail: String(err) };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const llmCases = results.filter(r => !r.detail?.startsWith('skipped'));
  const passed = llmCases.filter(r => r.pass).length;
  const errorRate = llmCases.length > 0 ? (llmCases.length - passed) / llmCases.length : 0;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Error rate:  ${(errorRate * 100).toFixed(1)}% (${llmCases.length - passed} errors / ${llmCases.length} LLM cases)`);
  console.log(`Model:       ${options.modelSpec} (${alias})`);
}
