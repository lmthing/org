/**
 * Tasklist eval grader.
 *
 * Primary metrics:
 *   1. DAG scheduling correctness: fraction where model starts tasks in valid topological order
 *   2. Completion rate: fraction where model completes all required tasks
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
  dagValid: boolean;
  allRequiredDone: boolean;
  detail?: string;
}

// ── Parse task operation calls from generated code ──

interface TaskOp {
  op: 'start' | 'finish' | 'fail' | 'skip';
  taskId: string;
  position: number;
}

function parseTaskOps(code: string): TaskOp[] {
  const ops: TaskOp[] = [];
  const re = /\.(start|finish|fail|skip)\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    ops.push({
      op: m[1] as TaskOp['op'],
      taskId: m[2],
      position: m.index,
    });
  }
  return ops;
}

// ── Parse tasklist dag from generated code ──

interface DagEdge {
  from: string;
  to: string;
}

function parseDagDeps(code: string): DagEdge[] {
  const edges: DagEdge[] = [];
  // Match deps: ['taskA', 'taskB'] patterns near a task id
  const depsRe = /['"]([^'"]+)['"]\s*:\s*\{[^}]*deps\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = depsRe.exec(code)) !== null) {
    const taskId = m[1];
    const depsList = m[2];
    const depRe = /['"]([^'"]+)['"]/g;
    let dm: RegExpExecArray | null;
    while ((dm = depRe.exec(depsList)) !== null) {
      edges.push({ from: dm[1], to: taskId });
    }
  }
  return edges;
}

function validateDagOrdering(ops: TaskOp[], edges: DagEdge[]): boolean {
  const startOps = ops.filter((o) => o.op === 'start');
  const finishOps = ops.filter((o) => o.op === 'finish' || o.op === 'skip');

  // Build finish position map
  const finishedAt = new Map<string, number>();
  for (const op of finishOps) {
    finishedAt.set(op.taskId, op.position);
  }

  // For each start, verify all deps were finished before
  for (const startOp of startOps) {
    const depsForTask = edges.filter((e) => e.to === startOp.taskId).map((e) => e.from);
    for (const dep of depsForTask) {
      const depFinish = finishedAt.get(dep);
      if (depFinish === undefined) return false;
      if (depFinish > startOp.position) return false;
    }
  }

  return true;
}

function hasRequiredCalls(code: string, expected: Record<string, unknown>): boolean {
  if (expected['hasTasklist'] && !/\btasklist\s*\(/.test(code)) return false;
  if (expected['hasStart'] && !/\.start\s*\(/.test(code)) return false;
  if (expected['hasFinish'] && !/\.finish\s*\(/.test(code)) return false;
  if (expected['hasFail'] && !/\.fail\s*\(/.test(code)) return false;
  if (expected['hasSkip'] && !/\.skip\s*\(/.test(code)) return false;
  if (expected['hasNudge'] && !/\.nudge\s*\(/.test(code)) return false;
  if (expected['hasGetAll'] && !/\.getAll\s*\(/.test(code)) return false;
  if (expected['hasStatus'] && !/\.status\s*\(/.test(code)) return false;
  if (expected['hasInspect'] && !/\binspect\s*\(/.test(code)) return false;
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

async function runTasklistCase(
  entry: DatasetEntry,
  model: RunOptions['model'],
  systemPrompt: string,
): Promise<CaseResult> {
  const task = entry.input['task'] as string ?? entry.description;

  const userTurn = `// User: ${task}`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userTurn,
  });

  const code = stripFences(text.trim());
  const ops = parseTaskOps(code);
  const edges = parseDagDeps(code);

  const dagValid = !entry.expected['respectsDeps'] || validateDagOrdering(ops, edges);
  const allRequiredDone = hasRequiredCalls(code, entry.expected);

  const pass = dagValid && allRequiredDone;

  return {
    id: entry.id,
    label: entry.label,
    pass,
    dagValid,
    allRequiredDone,
    detail: !dagValid
      ? 'invalid DAG ordering'
      : !allRequiredDone
        ? 'missing required API calls'
        : undefined,
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
      result = await runTasklistCase(entry, model, systemPrompt);
    } catch (err) {
      result = {
        id: entry.id,
        label: entry.label,
        pass: false,
        dagValid: false,
        allRequiredDone: false,
        detail: String(err),
      };
    }

    console.log(result.pass ? '✓' : `✗ — ${result.detail ?? ''}`);
    results.push(result);
  }

  const total = results.length;
  const dagValidCount = results.filter((r) => r.dagValid).length;
  const completionCount = results.filter((r) => r.allRequiredDone).length;
  const passCount = results.filter((r) => r.pass).length;

  const dagRate = total > 0 ? dagValidCount / total : 1;
  const completionRate = total > 0 ? completionCount / total : 1;

  console.log('\n── Results ──────────────────────────────────────');
  console.log(`DAG scheduling correctness: ${(dagRate * 100).toFixed(1)}% (${dagValidCount}/${total})`);
  console.log(`Required calls present:     ${(completionRate * 100).toFixed(1)}% (${completionCount}/${total})`);
  console.log(`Overall pass rate:          ${(passCount / total * 100).toFixed(1)}% (${passCount}/${total})`);
  console.log(`Model:                      ${options.modelSpec} (${alias})`);
}
