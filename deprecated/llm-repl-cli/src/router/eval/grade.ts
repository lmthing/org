/**
 * Router eval grader — Phase 12
 *
 * Runs router or analyzer eval depending on opts.role.
 * Uses inline dataset (no JSONL file).
 */
import { generateText } from 'ai';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RouterDecision } from '../router.js';
import type { AnalyzerResult } from '../analyzer.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface RunOptions {
  role: string;
  alias: string;
  modelSpec: string;
  model: Parameters<typeof generateText>[0]['model'];
}

// ── Inline datasets ──────────────────────────────────────────────────────────

interface RouterCase {
  id: string;
  label: string;
  input: Record<string, unknown>;
  expected: Partial<RouterDecision>;
}

interface AnalyzerCase {
  id: string;
  label: string;
  userMessage: string;
  expected: Partial<AnalyzerResult>;
}

const ROUTER_CASES: RouterCase[] = [
  {
    id: 'r1',
    label: 'default routing',
    input: { trigger: 'post_inspect', errorStreak: 0, annotationMismatchStreak: 0, tokensRemaining: 8000, heapMB: 10, heapMaxMB: 64, hasTasklist: true, hasInProgressTask: false, tasksCompleted: 0, totalTasks: 0 },
    expected: { role: 'EXEC_STANDARD', alias: 'S' },
  },
  {
    id: 'r2',
    label: 'errorStreak=3 → RECOVERY + M_R',
    input: { trigger: 'post_inspect', errorStreak: 3, annotationMismatchStreak: 0, tokensRemaining: 8000, heapMB: 10, heapMaxMB: 64, hasTasklist: true, hasInProgressTask: false, tasksCompleted: 0, totalTasks: 0 },
    expected: { role: 'RECOVERY', alias: 'M_R' },
  },
  {
    id: 'r3',
    label: 'errorStreak=5 → RECOVERY + L_R',
    input: { trigger: 'post_inspect', errorStreak: 5, annotationMismatchStreak: 0, tokensRemaining: 8000, heapMB: 10, heapMaxMB: 64, hasTasklist: true, hasInProgressTask: false, tasksCompleted: 0, totalTasks: 0 },
    expected: { role: 'RECOVERY', alias: 'L_R' },
  },
  {
    id: 'r4',
    label: 'tokensRemaining < 2000 → budgetWarning',
    input: { trigger: 'post_inspect', errorStreak: 0, annotationMismatchStreak: 0, tokensRemaining: 1500, heapMB: 10, heapMaxMB: 64, hasTasklist: true, hasInProgressTask: false, tasksCompleted: 0, totalTasks: 0 },
    expected: { role: 'EXEC_STANDARD', alias: 'S', flags: { budgetWarning: true, heapWarning: false, recoveryContext: false } },
  },
  {
    id: 'r5',
    label: 'no tasklist + new_message → ANALYZER',
    input: { trigger: 'new_message', errorStreak: 0, annotationMismatchStreak: 0, tokensRemaining: 8000, heapMB: 10, heapMaxMB: 64, hasTasklist: false, hasInProgressTask: false, tasksCompleted: 0, totalTasks: 0 },
    expected: { role: 'ANALYZER', alias: 'XS' },
  },
];

const ANALYZER_CASES: AnalyzerCase[] = [
  {
    id: 'a1',
    label: 'trivial arithmetic → simple',
    userMessage: 'What is 2 + 2?',
    expected: { difficulty: 'simple', skip_planner: true },
  },
  {
    id: 'a2',
    label: 'fetch and summarize → moderate',
    userMessage: 'Fetch https://example.com and summarize the content.',
    expected: { difficulty: 'moderate' },
  },
  {
    id: 'a3',
    label: 'build REST API → complex',
    userMessage: 'Build a full REST API with authentication, database integration, and unit tests.',
    expected: { difficulty: 'complex' },
  },
];

// ── Prompt loader ─────────────────────────────────────────────────────────────

async function loadPrompt(role: string): Promise<string> {
  const name = role === 'router' ? 'router' : 'analyzer';
  const promptPath = join(__dirname, `${name}.md`);
  return readFile(promptPath, 'utf8');
}

// ── Router eval ───────────────────────────────────────────────────────────────

interface RouterCaseResult {
  id: string;
  label: string;
  pass: boolean;
  actual?: Partial<RouterDecision>;
  detail?: string;
}

async function runRouterCase(
  entry: RouterCase,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<RouterCaseResult> {
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: JSON.stringify(entry.input, null, 2),
  });

  let actual: Partial<RouterDecision>;
  try {
    const stripped = text
      .replace(/^```json\n?/m, '')
      .replace(/^```\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();
    actual = JSON.parse(stripped) as Partial<RouterDecision>;
  } catch (err) {
    return { id: entry.id, label: entry.label, pass: false, detail: `JSON parse error: ${String(err)}` };
  }

  const exp = entry.expected;
  let pass = true;

  if (exp.role && actual.role !== exp.role) pass = false;
  if (exp.alias && actual.alias !== exp.alias) pass = false;
  if (exp.flags) {
    const actualFlags = actual.flags ?? {};
    for (const [k, v] of Object.entries(exp.flags)) {
      if ((actualFlags as Record<string, boolean>)[k] !== v) { pass = false; break; }
    }
  }

  return { id: entry.id, label: entry.label, pass, actual };
}

// ── Analyzer eval ─────────────────────────────────────────────────────────────

interface AnalyzerCaseResult {
  id: string;
  label: string;
  pass: boolean;
  actual?: Partial<AnalyzerResult>;
  detail?: string;
}

async function runAnalyzerCase(
  entry: AnalyzerCase,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<AnalyzerCaseResult> {
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: entry.userMessage,
  });

  let actual: Partial<AnalyzerResult>;
  try {
    const stripped = text
      .replace(/^```json\n?/m, '')
      .replace(/^```\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();
    actual = JSON.parse(stripped) as Partial<AnalyzerResult>;
  } catch (err) {
    return { id: entry.id, label: entry.label, pass: false, detail: `JSON parse error: ${String(err)}` };
  }

  const exp = entry.expected;
  let pass = true;

  if (exp.difficulty && actual.difficulty !== exp.difficulty) pass = false;
  if ('skip_planner' in exp && actual.skip_planner !== exp.skip_planner) pass = false;

  return { id: entry.id, label: entry.label, pass, actual };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function run(opts: RunOptions): Promise<void> {
  const { role, model, modelSpec, alias } = opts;

  const isRouter = role === 'router';
  const isAnalyzer = role === 'analyzer';

  if (!isRouter && !isAnalyzer) {
    console.error(`Unknown role: "${role}". Valid: router | analyzer`);
    process.exit(1);
  }

  const systemPrompt = await loadPrompt(role);

  if (isRouter) {
    console.log(`Running router eval (${ROUTER_CASES.length} cases) — model: ${modelSpec} (${alias})`);
    const results: RouterCaseResult[] = [];

    for (const entry of ROUTER_CASES) {
      process.stdout.write(`  [${entry.id}] ${entry.label} ... `);
      let result: RouterCaseResult;
      try {
        result = await runRouterCase(entry, model, systemPrompt);
      } catch (err) {
        result = { id: entry.id, label: entry.label, pass: false, detail: String(err) };
      }
      console.log(result.pass ? '✓' : `✗ — ${result.detail ?? JSON.stringify(result.actual)}`);
      results.push(result);
    }

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log(`\n── Results ──────────────────────────────────`);
    console.log(`Pass rate: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);
    console.log(`Model: ${modelSpec} (${alias})`);
  }

  if (isAnalyzer) {
    console.log(`Running analyzer eval (${ANALYZER_CASES.length} cases) — model: ${modelSpec} (${alias})`);
    const results: AnalyzerCaseResult[] = [];

    for (const entry of ANALYZER_CASES) {
      process.stdout.write(`  [${entry.id}] ${entry.label} ... `);
      let result: AnalyzerCaseResult;
      try {
        result = await runAnalyzerCase(entry, model, systemPrompt);
      } catch (err) {
        result = { id: entry.id, label: entry.label, pass: false, detail: String(err) };
      }
      console.log(result.pass ? '✓' : `✗ — ${result.detail ?? JSON.stringify(result.actual)}`);
      results.push(result);
    }

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log(`\n── Results ──────────────────────────────────`);
    console.log(`Pass rate: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);
    console.log(`Model: ${modelSpec} (${alias})`);
  }
}
