/**
 * Build the system + user prompt for a space-driven session from disk.
 *
 * Everything the LLM sees is composed from the on-disk space layout — no
 * code-level prompt templates. The prompt assembles:
 *
 *   - A short preamble explaining the REPL contract.
 *   - The selected agent's `instruct.md` body.
 *   - The active flow step's `<N>.<Name>.md` body (the cycle's task).
 *   - A relevant slice of the knowledge tree (caller-provided keys).
 *   - The library + space-overlay `.d.ts` so the LLM knows the host surface.
 *   - The flow sink declaration (e.g. `submitBrief`).
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { parseFrontmatter } from './frontmatter.js';
import { LIBRARY_AMBIENT_DTS } from './library-dts.js';
import { extractOverlayDts } from './overlay-dts.js';

export interface FlowSink {
  /** Name of the host global the LLM calls to end the session. */
  name: string;
  /** TypeScript signature, e.g. `(markdown: string) => void`. */
  signature: string;
  /** Short description shown to the LLM. */
  description: string;
}

export interface FlowStep {
  /** 1-based step number from the file name (`1.Gather.md` → 1). */
  number: number;
  /** Display name (`1.Gather.md` → "Gather"). */
  name: string;
  /** Raw frontmatter as a key/value map. */
  data: Record<string, unknown>;
  /** Body text after the closing `---`. */
  body: string;
}

export interface FlowTaskNode {
  description: string;
  /** Other task ids this depends on (DAG edges). */
  dependsOn?: string[];
  /** Optional output schema — caller-defined, passed verbatim to tasklist(). */
  outputSchema?: Record<string, unknown>;
}

export interface LoadedFlow {
  slug: string;
  /** Parsed `index.md` frontmatter (sink, defaultAgent, tasks, etc.). */
  data: Record<string, unknown>;
  /** Title from `index.md` frontmatter. */
  title: string;
  /** Description / preamble body of `index.md`. */
  description: string;
  /** Ordered step files. */
  steps: FlowStep[];
  /** Required sink declaration. */
  sink: FlowSink;
  /** Default cycle budget = number of steps. */
  defaultMaxCycles: number;
  /** Default agent slug, if specified in the flow's frontmatter. */
  defaultAgent?: string;
  /** Tasklist DAG — declared once at session start, progressed across cycles. */
  tasks?: Record<string, FlowTaskNode>;
}

export interface LoadedAgent {
  slug: string;
  data: Record<string, unknown>;
  title: string;
  body: string;
  /** Parsed `config.json` — knowledge selectors, functions, components. */
  config?: Record<string, unknown>;
}

// ── Disk readers ───────────────────────────────────────────────────────────

async function safeRead(p: string): Promise<string | undefined> {
  try { return await readFile(p, 'utf-8'); } catch { return undefined; }
}

async function safeReadDir(p: string): Promise<string[]> {
  try { return await readdir(p); } catch { return []; }
}

export async function loadAgent(spaceDir: string, slug: string): Promise<LoadedAgent> {
  const path = join(spaceDir, 'agents', slug, 'instruct.md');
  const raw = await safeRead(path);
  if (raw === undefined) {
    throw new Error(`Agent not found: ${slug} (looked for ${path})`);
  }
  const { data, body } = parseFrontmatter(raw);

  let config: Record<string, unknown> | undefined;
  const configRaw = await safeRead(join(spaceDir, 'agents', slug, 'config.json'));
  if (configRaw) {
    try { config = JSON.parse(configRaw) as Record<string, unknown>; } catch { /* malformed config — skip */ }
  }

  return {
    slug,
    data,
    title: (data.title as string) ?? slug,
    body: body.trim(),
    config,
  };
}

export async function listAgents(spaceDir: string): Promise<string[]> {
  return (await safeReadDir(join(spaceDir, 'agents'))).filter(
    (n) => !n.startsWith('.'),
  );
}

export async function loadFlow(spaceDir: string, slug: string): Promise<LoadedFlow> {
  const flowDir = join(spaceDir, 'flows', slug);
  const indexRaw = await safeRead(join(flowDir, 'index.md'));
  if (indexRaw === undefined) {
    throw new Error(`Flow not found: ${slug} (looked for ${flowDir}/index.md)`);
  }
  const { data: indexData, body: indexBody } = parseFrontmatter(indexRaw);

  const sinkData = indexData.sink as Record<string, unknown> | undefined;
  if (!sinkData || typeof sinkData !== 'object' || !(sinkData as Record<string, unknown>).name) {
    throw new Error(
      `Flow ${slug}/index.md is missing required \`sink\` frontmatter ` +
      `(expected sink: { name, signature, description }).`,
    );
  }
  const sink: FlowSink = {
    name: String((sinkData as Record<string, unknown>).name),
    signature: String((sinkData as Record<string, unknown>).signature ?? '(value: unknown) => void'),
    description: String((sinkData as Record<string, unknown>).description ?? 'Terminate the session.'),
  };

  const stepFiles = (await safeReadDir(flowDir))
    .filter((f) => /^\d+\..+\.md$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const steps: FlowStep[] = [];
  for (const f of stepFiles) {
    const raw = await safeRead(join(flowDir, f)) ?? '';
    const { data, body } = parseFrontmatter(raw);
    const numMatch = /^(\d+)\.(.+)\.md$/.exec(f)!;
    steps.push({
      number: parseInt(numMatch[1]!, 10),
      name: numMatch[2]!,
      data,
      body: body.trim(),
    });
  }

  if (steps.length === 0) {
    throw new Error(`Flow ${slug} has no step files`);
  }

  const tasks = parseTasksFrontmatter(indexData.tasks);

  return {
    slug,
    data: indexData,
    title: (indexData.title as string) ?? slug,
    description: indexBody.trim(),
    steps,
    sink,
    defaultMaxCycles: typeof indexData.maxCycles === 'number'
      ? (indexData.maxCycles as number)
      : steps.length * 3,
    ...(indexData.defaultAgent ? { defaultAgent: String(indexData.defaultAgent) } : {}),
    ...(tasks ? { tasks } : {}),
  };
}

function parseTasksFrontmatter(raw: unknown): Record<string, FlowTaskNode> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, FlowTaskNode> = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const node = val as Record<string, unknown>;
    const description = String(node.description ?? '');
    const dependsOn = Array.isArray(node.dependsOn)
      ? (node.dependsOn as unknown[]).map((d) => String(d))
      : undefined;
    out[id] = {
      description,
      ...(dependsOn ? { dependsOn } : {}),
      ...(node.outputSchema && typeof node.outputSchema === 'object'
        ? { outputSchema: node.outputSchema as Record<string, unknown> }
        : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function listFlows(spaceDir: string): Promise<string[]> {
  return (await safeReadDir(join(spaceDir, 'flows'))).filter(
    (n) => !n.startsWith('.'),
  );
}

// ── Knowledge slice loader ─────────────────────────────────────────────────

export interface KnowledgeSlice {
  domain: string;
  field: string;
  options: Array<{ option: string; body: string }>;
}

export async function loadKnowledge(
  spaceDir: string,
  selectors: Array<{ domain: string; field: string; option?: string }>,
): Promise<KnowledgeSlice[]> {
  const out: KnowledgeSlice[] = [];
  for (const sel of selectors) {
    const fieldDir = join(spaceDir, 'knowledge', sel.domain, sel.field);
    const files = (await safeReadDir(fieldDir)).filter((f) => f.endsWith('.md'));
    const options: Array<{ option: string; body: string }> = [];
    for (const f of files) {
      const name = basename(f, '.md');
      if (sel.option && name !== sel.option) continue;
      const raw = await safeRead(join(fieldDir, f)) ?? '';
      const { body } = parseFrontmatter(raw);
      options.push({ option: name, body: body.trim() });
    }
    if (options.length > 0) out.push({ domain: sel.domain, field: sel.field, options });
  }
  return out;
}

// ── Prompt composition ─────────────────────────────────────────────────────

export interface BuildPromptInput {
  spaceDir: string;
  agent: LoadedAgent;
  flow: LoadedFlow;
  /** 1-based cycle number — selects which flow step is the current task. */
  cycle: number;
  /** Optional knowledge selectors to splice into the prompt. */
  knowledge?: Array<{ domain: string; field: string; option?: string }>;
  /** Optional extra preamble lines (e.g. "configured providers: ..."). */
  extraContext?: string[];
}

export interface BuiltPrompt {
  systemPrompt: string;
  ambientDts: string;
  /** The active step's `name` (debug-friendly handle). */
  activeStepName: string;
}

const PREAMBLE = `You are an LLM running inside @lmthing/llm-repl — a TypeScript REPL with a QuickJS sandbox.

You answer the user by **writing TypeScript code** that the host parses with \`tsc\`, transpiles to JavaScript, and executes inside a sandboxed VM. The host bridges to its environment via host-injected globals declared below.

## How to respond

Output **only executable TypeScript**, no prose, no markdown code fences, no \`\`\`ts wrappers, no explanations between statements. Use full TypeScript syntax: type annotations, interfaces, generics, \`as\` casts. The host transpiles your statement to JS before running it. Top-level \`await\` is supported.

## Cycle protocol

Each cycle is one LLM completion. Wrap your work in a single statement (or sequence ending in your final call). End each non-final cycle with \`await inspect(...args)\` to yield. End the final cycle with the flow's sink call (see below).

## inspect() and querying

\`inspect\` ALWAYS takes a **list of bare variables**, one per positional argument — **never an object literal**. The host recovers each argument's name from the source identifier and surfaces it in the next cycle's context as a \`__<name>\` constant.

\`\`\`ts
// ✓ correct
await inspect(results, excerpts);

// ✗ wrong — names are lost when wrapped in an object
await inspect({ results, excerpts });
\`\`\`

Surfaced values are **truncated to a preview** so the prompt stays small. Long strings show only their first ~400 chars, arrays show only their first ~5 items, deeply nested objects collapse to a placeholder. Each truncated leaf carries a marker telling you the exact query to read more.

To drill into a specific slice, pass a tuple \`[variable, InspectQuery]\`:

\`\`\`ts
await inspect([excerpts, { slice: [0, 3] }]);                 // first 3 items
await inspect([excerpts, { sample: 5 }]);                     // 5 evenly-spaced
await inspect([excerpts, { filter: "el.url.includes('github.com')" }]);
await inspect([excerpts, { keys: true }]);                    // structure only
await inspect([excerpts, { count: true }]);                   // length only
await inspect([excerpts[0], { path: "text", slice: [0, 5000] }]);  // 5000 chars of one .text
await inspect([excerpts, { search: "kubernetes" }]);          // items mentioning the term
\`\`\`

Mix positional bare vars with tuples freely:
\`\`\`ts
await inspect(results, [excerpts, { slice: [0, 3] }]);
\`\`\`

Only request what you'll actually read in the next cycle.`;

export async function buildAgentPrompt(input: BuildPromptInput): Promise<BuiltPrompt> {
  const { spaceDir, agent, flow, cycle, extraContext = [] } = input;
  const step = flow.steps[Math.min(cycle - 1, flow.steps.length - 1)];
  if (!step) throw new Error(`Flow ${flow.slug} has no step for cycle ${cycle}`);

  const knowledgeSlices = input.knowledge ? await loadKnowledge(spaceDir, input.knowledge) : [];
  const overlay = await extractOverlayDts({ spaceDir });
  const sinkDts = `// ── Flow sink (registered by the CLI; calling this terminates the session) ──\ndeclare const ${flow.sink.name}: ${flow.sink.signature};`;
  const ambientDts = [LIBRARY_AMBIENT_DTS, sinkDts, overlay.dts].join('\n\n');

  const knowledgeBlock =
    knowledgeSlices.length === 0
      ? ''
      : `\n## Knowledge\n\n` +
        knowledgeSlices
          .map(
            (s) => `### ${s.domain} · ${s.field}\n\n` +
              s.options.map((o) => `**${o.option}**\n${o.body}`).join('\n\n'),
          )
          .join('\n\n');

  const extraBlock = extraContext.length === 0 ? '' : `\n## Context\n\n${extraContext.map((l) => `- ${l}`).join('\n')}`;

  // ── Tasklist DAG block (if the flow declared one) ─────────────────────────
  const stepTaskIds = Array.isArray(step.data.tasks)
    ? (step.data.tasks as unknown[]).map((t) => String(t))
    : [];

  let tasklistBlock = '';
  if (flow.tasks) {
    const isFirstCycle = cycle === 1;
    const dagLiteral = formatTasklistDeclaration(flow.slug, flow.tasks);
    const stepNodes = stepTaskIds.length > 0
      ? stepTaskIds
      : Object.keys(flow.tasks);
    tasklistBlock = `

## Tasklist harness

This flow is a task DAG. The runtime preserves task state across cycles by id, so always **re-bind** the handle at the start of every cycle:

\`\`\`ts
const __flow = tasklist(${JSON.stringify(flow.slug)}, ${dagLiteral});
\`\`\`

The literal above is the canonical DAG — emit it verbatim. Calling \`tasklist(id, dag)\` with an id that's already registered returns the existing handle with **preserved task state** from prior cycles. Top-level \`const\` bindings do NOT survive across cycles, so this re-bind is required every time.

**This cycle handles the following nodes**${stepTaskIds.length > 0 ? ' (in order)' : ''}: \`${stepNodes.join('\`, \`')}\`

For each node:

\`\`\`ts
__flow.start("nodeId");          // mark in-progress; runtime enforces dependsOn order
// ...do the work, produce a value matching the node's outputSchema
__flow.finish("nodeId", value);   // validates schema and unblocks dependents
\`\`\`

Do not skip ahead or finish a node out of order — the runtime will reject it. **Only handle the nodes assigned to this cycle**; do NOT race through later phases. End the cycle by surfacing the values produced via \`await inspect(...)\`.`;
  }

  const systemPrompt = `${PREAMBLE}

## Agent: ${agent.title}

${agent.body}

## Flow: ${flow.title} — step ${step.number} of ${flow.steps.length} (${step.name})

${step.body}
${extraBlock}${knowledgeBlock}${tasklistBlock}

## Host surface

Library primitives (\`inspect\`, \`display\`, \`ask\`, \`budget\`, \`checkpoint\`, \`pin\`, \`compact\`, \`fork\`, \`tasklist\`, \`fetch\`, \`fs\`, …), the flow's sink \`${flow.sink.name}\`, and the space's auto-discovered functions and components are all type-visible to \`tsc\` when your TypeScript is compiled. A diagnostic naming the offending function/argument will be surfaced if you call something incorrectly.

## Termination

Call **\`${flow.sink.name}\`** — ${flow.sink.description} — exactly once when ready to end the session. Signature: \`${flow.sink.signature}\`.

## ask() — one form per step

Never call \`ask()\` more than once per cycle. Combine all inputs into a **single** \`ask()\` call by wrapping fields in a \`<div>\`. Each input component must have a \`name\` prop — \`ask()\` resolves to a \`Record<string, string>\` keyed by those names.

Built-in input components (always available as globals): \`TextInput\`, \`TextArea\`, \`NumberInput\`, \`Slider\`, \`Checkbox\`, \`Select\`, \`MultiSelect\`, \`DatePicker\` — all accept \`name\` (required), \`label\`, \`placeholder\`, \`defaultValue\`.

\`\`\`ts
// ✓ correct — all fields in one ask()
const answers = await ask<Record<string, string>>(
  <div>
    <TextInput name="dish" label="What would you like to cook?" />
    <NumberInput name="servings" label="Servings?" defaultValue={4} />
    <TextInput name="restrictions" label="Dietary restrictions (leave blank if none)" />
  </div>,
  { fallback: { dish: "pasta", servings: "4", restrictions: "" } },
);
// access: answers.dish  answers.servings  answers.restrictions

// ✗ wrong — multiple ask() calls create separate unsubmittable forms
\`\`\`

## Rules

- Output ONLY executable TypeScript, no commentary, no markdown fences.
- Use top-level \`await\` directly — no IIFEs needed.
- Wrap risky host calls in try/catch so one failure doesn't kill the cycle.
- End each non-final cycle with \`await inspect(var1, var2, ...)\`.
- End the final cycle with exactly one call to \`${flow.sink.name}\`.`;

  return { systemPrompt, ambientDts, activeStepName: step.name };
}

function formatTasklistDeclaration(_id: string, tasks: Record<string, FlowTaskNode>): string {
  const lines: string[] = ['{'];
  for (const [id, node] of Object.entries(tasks)) {
    const parts: string[] = [`description: ${JSON.stringify(node.description)}`];
    if (node.dependsOn && node.dependsOn.length > 0) {
      parts.push(`dependsOn: ${JSON.stringify(node.dependsOn)}`);
    }
    if (node.outputSchema) {
      parts.push(`outputSchema: ${JSON.stringify(node.outputSchema)}`);
    }
    lines.push(`  ${id}: { ${parts.join(', ')} },`);
  }
  lines.push('}');
  return lines.join('\n');
}

export function buildUserPrompt(input: {
  cycle: number;
  task: string;
  reconstruction?: string;
}): string {
  if (input.cycle === 1) {
    return `Task: ${input.task}\n\nBegin cycle 1 now.`;
  }
  if (input.reconstruction) {
    return input.reconstruction + `\n\nProceed with the current cycle. End with \`await inspect(var1, var2, ...)\` or call the flow's sink to terminate.`;
  }
  return `Cycle ${input.cycle} — your previous cycle did not end with inspect() or the sink. Resume properly.`;
}
