/**
 * Typecheck eval grader.
 *
 * Primary metric: self-correction rate.
 *   Fraction of type-error traces where the model fixes the error within 3 retries,
 *   measured by running tsc on the model's output.
 *
 * The grader calls the real model configured in LM_MODEL_<ALIAS> and drives the
 * tsc-runner + retry loop to score actual self-correction capability.
 */
import { generateText } from 'ai';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTsc } from '../tsc-runner.js';

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
  const name = alias.toLowerCase().replace('_', '_');
  const promptPath = join(__dirname, 'prompts', `${name}.md`);
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(promptPath, 'utf8');
  } catch {
    // Fall back to m.md if alias-specific prompt not found
    return readFile(join(__dirname, 'prompts', 'm.md'), 'utf8');
  }
}

interface CaseResult {
  id: string;
  label: string;
  pass: boolean;
  attempts: number;
  finalOk: boolean;
  detail?: string;
}

/**
 * Run a self-correction eval case.
 * Presents the broken statement to the model, runs tsc, retries with error feedback.
 */
async function runSelfCorrectionCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const brokenStatement = entry.input['statement'] as string | undefined;
  if (!brokenStatement) {
    return { id: entry.id, label: entry.label, pass: false, attempts: 0, finalOk: false, detail: 'no input.statement' };
  }

  const MAX_ATTEMPTS = 3;
  let current = brokenStatement;
  let lastDiagnostics: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const tscResult = runTsc(current);

    if (tscResult.ok) {
      const expectedOk = entry.expected['final_ok'] as boolean ?? true;
      return {
        id: entry.id,
        label: entry.label,
        pass: expectedOk,
        attempts: attempt,
        finalOk: true,
      };
    }

    if (attempt === MAX_ATTEMPTS) {
      const expectedOk = entry.expected['final_ok'] as boolean ?? true;
      return {
        id: entry.id,
        label: entry.label,
        pass: !expectedOk, // if expected to fail, still pass
        attempts: attempt,
        finalOk: false,
        detail: `exhausted ${MAX_ATTEMPTS} attempts; last errors: ${tscResult.diagnostics.map(d => d.message).join('; ')}`,
      };
    }

    // Build context reconstruction user turn with __errors in production format
    const errorsJson = JSON.stringify(
      tscResult.diagnostics.map(d => ({
        kind: 'type',
        message: `tsc(${d.code}): ${d.message.replace(/\n/g, ' ')}`,
        statement: current,
      })),
      null,
      2,
    );
    const userTurn = [
      `// ═══ inspect #${attempt} ═══`,
      ``,
      `const __budget: Budget = { tokensUsed: 0, tokensRemaining: 8000, inspectCount: ${attempt - 1}, nearingLimit: false };`,
      `const __scope = {};`,
      `const __errors: SessionError[] = ${errorsJson};`,
    ].join('\n');

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: userTurn,
    });

    // Extract raw statement — strip markdown fences if present
    current = stripFences(text.trim());
    lastDiagnostics = tscResult.diagnostics.map(d => d.message);
  }

  return { id: entry.id, label: entry.label, pass: false, attempts: MAX_ATTEMPTS, finalOk: false };
}

/**
 * Run a "clean pass" case — model should write valid TypeScript on the first attempt.
 */
async function runCleanPassCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const task = entry.description;

  const userTurn = [
    `// ═══ inspect #1 ═══`,
    ``,
    `const __budget: Budget = { tokensUsed: 0, tokensRemaining: 8000, inspectCount: 0, nearingLimit: false };`,
    `const __scope = {};`,
    `// User: ${task}`,
  ].join('\n');

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const statement = stripFences(text.trim());
  const result = runTsc(statement);

  const expectedOk = entry.expected['final_ok'] as boolean ?? true;
  return {
    id: entry.id,
    label: entry.label,
    pass: result.ok === expectedOk,
    attempts: 1,
    finalOk: result.ok,
    detail: result.ok ? undefined : result.diagnostics.map(d => d.message).join('; '),
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
      if (entry.label.startsWith('self-correction')) {
        result = await runSelfCorrectionCase(entry, model, systemPrompt);
      } else if (entry.label.startsWith('clean-pass')) {
        result = await runCleanPassCase(entry, model, systemPrompt);
      } else {
        // Skip non-LLM cases (speculative, grace — those are unit-tested)
        result = { id: entry.id, label: entry.label, pass: true, attempts: 0, finalOk: true, detail: 'skipped (non-LLM case)' };
      }
    } catch (err) {
      result = { id: entry.id, label: entry.label, pass: false, attempts: 0, finalOk: false, detail: String(err) };
    }

    console.log(result.pass ? `✓ (${result.attempts} attempt(s))` : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  // Compute metrics
  const llmCases = results.filter(r => r.attempts > 0);
  const correctionCases = results.filter(r => r.label.startsWith('self-correction'));
  const cleanCases = results.filter(r => r.label.startsWith('clean-pass'));

  const selfCorrectionRate = correctionCases.length > 0
    ? correctionCases.filter(r => r.pass).length / correctionCases.length
    : 1;

  const firstPassRate = cleanCases.length > 0
    ? cleanCases.filter(r => r.finalOk).length / cleanCases.length
    : 1;

  const avgAttempts = llmCases.length > 0
    ? llmCases.reduce((s, r) => s + r.attempts, 0) / llmCases.length
    : 0;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`Self-correction rate:  ${(selfCorrectionRate * 100).toFixed(1)}% (${correctionCases.filter(r => r.pass).length}/${correctionCases.length})`);
  console.log(`First-pass rate:       ${(firstPassRate * 100).toFixed(1)}% (${cleanCases.filter(r => r.finalOk).length}/${cleanCases.length})`);
  console.log(`Avg attempts (LLM):    ${avgAttempts.toFixed(2)}`);
  console.log(`Model:                 ${options.modelSpec} (${alias})`);
}
