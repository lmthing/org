import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import ts from 'typescript';
import { parseFrontmatter } from './frontmatter.js';
import { CAPABILITY_IDS, type CapabilityId } from './capabilities.js';
import type { Space } from './load.js';

export interface TaskNode {
  id: string;
  /** Node kind: `'agent'` runs a model fork over `instruction` (an `NN-<id>.md`
   *  file); `'code'` runs a host-injected `run(ctx, inputs)` loaded from
   *  `codeModulePath` (an `NN-<id>.ts` file); `'subgraph'` runs a named
   *  sub-tasklist (recursively, via the same `runTasklist`) and unwraps its
   *  `TaskEnvelope.data` as this node's output; `'checkpoint'` is a barrier that
   *  records a durable "last green" resume marker. Defaults to `'agent'`. Core
   *  NEVER imports/executes a code node's module — the CLI/pod does, via the
   *  orchestrator's injected `codeNodeCtxFactory` (keeps core free of any
   *  transpile/Node-worker runtime). */
  kind: 'agent' | 'code' | 'subgraph' | 'checkpoint';
  /** Absolute path to the code node's `.ts` module (`kind:'code'` only). Handed
   *  verbatim to the injected `codeNodeCtxFactory`; core does not read it. */
  codeModulePath?: string;
  /** Name of the sub-tasklist a `kind:'subgraph'` node runs (frontmatter
   *  `subgraph:`). Resolved against `space.tasklists` at run time; its seed is
   *  the same `{ ...tasklistSeed, ...upstreamOutputs }` a code node receives (plus
   *  `item`/`index` when this node also has `forEach`), and its `TaskEnvelope.data`
   *  becomes this node's output — so a slice (`model → queries → views → gates`)
   *  is one node, not N inlined copies. A subgraph naming a tasklist already on the
   *  call stack is a cycle and fails loudly. */
  subgraph?: string;
  instruction: string; // body of the .md file (empty for code nodes)
  output: Record<string, string>; // JSON-schema-ish: field -> type
  input?: Record<string, string>; // JSON-schema-ish: field -> type
  dependsOn?: string[];
  condition?: string; // DSL expression
  optional?: boolean;
  goal?: boolean;
  /** Fork capability profile for this task's subagent (default 'general' when omitted).
   *  Read-only roles ('explore'/'plan') cannot write files or run mutating shell. */
  role?: 'explore' | 'plan' | 'general';
  /** Model alias/spec THIS node's fork runs on (frontmatter `model:`) — lets an
   *  expensive judgement step pin a strong model while the rest of the tasklist runs
   *  the pod default. Highest-precedence model source for a task fork:
   *  `task.model ?? modelForRole(task.role, roleModels) ?? defaultModel` (fork.ts).
   *  Core treats it as an OPAQUE string; the provider layer resolves it (an alias like
   *  `s`/`m`/`l`, or a full `provider:modelId` spec such as
   *  `lmthingcloud:DeepSeek-V4-Flash`). */
  model?: string;
  /** Allowlist of space-function names available to this task's fork. When set, only these
   *  functions are injected + listed in the prompt (least privilege); omit for all. */
  functions?: string[];
  /** Host-driven fan-out: "<upstreamTaskId>.<field>" (or bare "<upstreamTaskId>") naming an
   *  upstream array. The host runs this task once per element, in parallel, and collects the
   *  resolved values into an array. The element is injected into each fork as `item` (+ `index`). */
  forEach?: string;
  /** Per-task delegation allowlist: `"space/agent"` (any action) or `"space/agent#action"`.
   *  When set, the task's fork may `delegate()` to exactly these targets (and nothing else). */
  canDelegateTo?: string[];
  /** Per-node capability NARROWING (least privilege per step). When set, the fork runs with
   *  only the intersection of these ids and the OWNING AGENT's declared capabilities — a node
   *  can never gain a cap the agent lacks (see `narrowAppCaps`). Bare ids only; each cap keeps
   *  the agent grant's scope config. Omit to inherit the agent's full set. */
  capabilities?: string[];
  /** Host-executed TS statements (YAML block scalar) run in the fork VM BEFORE the model's
   *  first turn — the task's deterministic setup (bindings, webSearch/webFetch gathering)
   *  executes with host reliability instead of being re-emitted by the model. Yields are
   *  allowed; failures degrade per-statement (never kill the fork). Deep validation happens
   *  at run time through the same typecheck pipeline as model statements. */
  prelude?: string;
  /** Resume an EARLIER step when this node's check fails, carrying the reason.
   *  After this node completes, `when` is evaluated against all outputs; if true (and the
   *  attempt budget is not spent) every node on a dependency path from `goto` through this
   *  node is un-done and re-runs. `dependsOn` stays acyclic — this is scheduler-level
   *  re-execution, not a graph edge. The `carry` field of THIS node's output is injected
   *  into the resumed nodes as `feedback` (with `attempt`), so the retry knows what to fix
   *  instead of repeating the same mistake. A plain retry loop is just `goto` naming this
   *  node's own body. */
  onFail?: TaskOnFail;
}

export interface TaskOnFail {
  /** Task id to resume from (inclusive). Must be a transitive dependency of this node. */
  goto: string;
  /** Condition DSL evaluated against all outputs after this node completes. Defaults to
   *  `"<taskId>.ok == false"`. NOTE: the DSL cannot index arrays
   *  (`condition-dsl.ts` `getAtPath`), so compare a SCALAR — emit `ok`/a count, never
   *  `errors.length`. */
  when?: string;
  /** Field of this node's output carrying the failure reason. Omit to carry the whole
   *  output. Surfaces on the resumed nodes as `feedback`. */
  carry?: string;
  /** Max resume attempts before giving up and letting the pipeline continue (so the goal
   *  task still runs and reports honestly). Default 2. */
  maxAttempts?: number;
}

export async function loadTasklist(dir: string, files: string[]): Promise<Record<string, TaskNode>> {
  const tasks: Record<string, TaskNode> = {};

  for (const filePath of files) {
    let task: TaskNode;
    if (filePath.endsWith('.ts')) {
      // Code node: statically extract its `node` metadata literal WITHOUT
      // importing/executing the module (core stays free of any transpile/worker
      // runtime — that lives in the CLI/pod, which runs `run(ctx, inputs)` later
      // via the orchestrator's injected factory). The metadata goes through the
      // EXACT same field validators as md-node frontmatter below.
      const raw = await readFile(filePath, 'utf8');
      const { node, hasRun } = extractCodeNodeMeta(raw, filePath);
      if (!hasRun) {
        throw new Error(
          `Code node "${filePath}" must export an async \`run(ctx, inputs)\` function`,
        );
      }
      const filename = basename(filePath, '.ts');
      task = buildTaskNode(node, {
        filename,
        filePath,
        kind: 'code',
        instruction: '',
        codeModulePath: resolve(filePath),
      });
    } else {
      const raw = await readFile(filePath, 'utf8');
      const { data, body } = parseFrontmatter(raw, filePath);
      // Derive ID from filename (strip numeric prefix and .md)
      const filename = basename(filePath, '.md');
      task = buildTaskNode(data, { filename, filePath, kind: 'agent', instruction: body.trim() });
    }
    tasks[task.id] = task;
  }

  return tasks;
}

/**
 * Build a TaskNode from a metadata record — either parsed `.md` frontmatter
 * (agent node) or the statically-extracted `node` object of a `.ts` file (code
 * node). The two paths share this single validator so a code node's
 * `id/dependsOn/condition/forEach/output/…` behave IDENTICALLY to an md node's.
 */
function buildTaskNode(
  data: Record<string, unknown>,
  opts: { filename: string; filePath: string; kind: 'agent' | 'code'; instruction: string; codeModulePath?: string },
): TaskNode {
  const { filename, filePath, kind, instruction, codeModulePath } = opts;

  // Remove leading numeric prefix like "01-" or "001_" (same rule for md + ts).
  const id = data['id']
    ? String(data['id'])
    : filename.replace(/^\d+[-_]?/, '') || filename;

  const output: Record<string, string> = {};
  if (data['output'] && typeof data['output'] === 'object' && !Array.isArray(data['output'])) {
    for (const [k, v] of Object.entries(data['output'] as Record<string, unknown>)) {
      output[k] = String(v);
    }
  }

  const task: TaskNode = { id, kind, instruction, output };
  if (codeModulePath) task.codeModulePath = codeModulePath;

  // Control-node kinds are md-authored (a `.ts` file is always a code node). A
  // `subgraph:` frontmatter key turns the node into a sub-tasklist call; a
  // `checkpoint: true` key turns it into a durable resume barrier. The two are
  // mutually exclusive, and neither can ride on a code node.
  if (kind !== 'code') {
    const hasSubgraph = data['subgraph'] !== undefined;
    const hasCheckpoint = data['checkpoint'] !== undefined;
    if (hasSubgraph && hasCheckpoint) {
      throw new Error(
        `Task "${id}" (${filePath}): a node is either a "subgraph" or a "checkpoint", not both`,
      );
    }
    if (hasSubgraph) {
      if (typeof data['subgraph'] !== 'string' || !data['subgraph'].trim()) {
        throw new Error(
          `Task "${id}" (${filePath}): "subgraph" must name the sub-tasklist to run (a non-empty string)`,
        );
      }
      task.kind = 'subgraph';
      task.subgraph = data['subgraph'].trim();
    } else if (hasCheckpoint) {
      if (data['checkpoint'] !== true) {
        throw new Error(
          `Task "${id}" (${filePath}): "checkpoint" is a marker — set it to \`true\` or omit it`,
        );
      }
      task.kind = 'checkpoint';
    }
  }

  if (data['input'] && typeof data['input'] === 'object' && !Array.isArray(data['input'])) {
    const input: Record<string, string> = {};
    for (const [k, v] of Object.entries(data['input'] as Record<string, unknown>)) {
      input[k] = String(v);
    }
    task.input = input;
  }

  if (Array.isArray(data['dependsOn'])) {
    task.dependsOn = data['dependsOn'].map(String);
  }
  if (typeof data['condition'] === 'string') {
    task.condition = data['condition'];
  }
  if (data['optional'] === true) {
    task.optional = true;
  }
  if (data['goal'] === true) {
    task.goal = true;
  }
  if (data['role'] === 'explore' || data['role'] === 'plan' || data['role'] === 'general') {
    task.role = data['role'];
  }
  if (data['model'] !== undefined) {
    // Opaque to core (an alias or a `provider:modelId` spec — the provider layer
    // resolves it), so the only load-time check is "a non-empty string". Rejected
    // loudly rather than ignored: a mistyped/empty `model:` would otherwise fall back
    // to the default silently, and the node would look pinned while it wasn't.
    if (typeof data['model'] !== 'string' || !data['model'].trim()) {
      throw new Error(
        `Task "${id}" (${filePath}): "model" must be a non-empty string (a model alias or a "provider:modelId" spec)`,
      );
    }
    task.model = data['model'].trim();
  }
  if (Array.isArray(data['functions'])) {
    task.functions = data['functions'].map(String);
  }
  if (typeof data['forEach'] === 'string' && data['forEach'].trim()) {
    task.forEach = data['forEach'].trim();
  }
  if (Array.isArray(data['canDelegateTo'])) {
    task.canDelegateTo = data['canDelegateTo'].map(String);
  }
  if (data['capabilities'] !== undefined) {
    if (!Array.isArray(data['capabilities'])) {
      throw new Error(
        `Task "${id}" (${filePath}): "capabilities" must be a list of bare capability ids (a per-node subset of the agent's grants)`,
      );
    }
    const ids = data['capabilities'].map(String);
    const unknown = ids.filter((c) => !CAPABILITY_IDS.has(c as CapabilityId));
    if (unknown.length > 0) {
      throw new Error(
        `Task "${id}" (${filePath}): unknown capability id(s) in "capabilities": ${unknown.join(', ')}. Known: ${[...CAPABILITY_IDS].join(', ')}`,
      );
    }
    task.capabilities = ids;
  }
  if (data['prelude'] !== undefined) {
    // Light load-time validation only (non-empty string). Deep validation is
    // deferred to run time, where each statement goes through the same
    // typecheck pipeline as model statements (see exec/prelude.ts). Only
    // meaningful for agent nodes; a code node never carries one in practice.
    if (typeof data['prelude'] !== 'string' || !data['prelude'].trim()) {
      throw new Error(
        `Task "${id}" (${filePath}): "prelude" must be a non-empty string of TypeScript statements`,
      );
    }
    task.prelude = data['prelude'];
  }
  if (data['onFail'] !== undefined) {
    const raw = data['onFail'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(
        `Task "${id}" (${filePath}): "onFail" must be a block with a "goto" task id (plus optional when/carry/maxAttempts)`,
      );
    }
    const cfg = raw as Record<string, unknown>;
    const goto = cfg['goto'];
    if (typeof goto !== 'string' || !goto.trim()) {
      throw new Error(`Task "${id}" (${filePath}): "onFail.goto" must name the task id to resume from`);
    }
    const onFail: TaskOnFail = { goto: goto.trim() };
    if (cfg['when'] !== undefined) {
      if (typeof cfg['when'] !== 'string' || !cfg['when'].trim()) {
        throw new Error(`Task "${id}" (${filePath}): "onFail.when" must be a condition expression`);
      }
      onFail.when = cfg['when'].trim();
    }
    if (cfg['carry'] !== undefined) {
      if (typeof cfg['carry'] !== 'string' || !cfg['carry'].trim()) {
        throw new Error(`Task "${id}" (${filePath}): "onFail.carry" must name a field of this task's output`);
      }
      onFail.carry = cfg['carry'].trim();
    }
    if (cfg['maxAttempts'] !== undefined) {
      const n = Number(cfg['maxAttempts']);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Task "${id}" (${filePath}): "onFail.maxAttempts" must be a positive integer`);
      }
      onFail.maxAttempts = n;
    }
    task.onFail = onFail;
  }

  return task;
}

/**
 * Statically extract a code node's exported `node` metadata object and confirm
 * it exports a `run` function — parsed from the `.ts` SOURCE with the TypeScript
 * compiler, never imported or executed. This keeps `@lmthing/core` free of any
 * transpile/Node-worker runtime (the constraint that lets the same core run in
 * the QuickJS sandbox). The `run(ctx, inputs)` body is deliberately ignored here;
 * it is loaded + executed later by the CLI/pod's injected `codeNodeCtxFactory`.
 *
 * Only static literal values are supported for the metadata (it is always plain
 * data: `id`/`dependsOn`/`condition`/`forEach`/`output`/…). A non-literal
 * expression is an authoring error and throws.
 */
export function extractCodeNodeMeta(source: string, filePath: string): { node: Record<string, unknown>; hasRun: boolean } {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
  let nodeObj: Record<string, unknown> | undefined;
  let hasRun = false;

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'run') {
      hasRun = true;
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (decl.name.text === 'node') {
          if (!ts.isObjectLiteralExpression(decl.initializer)) {
            throw new Error(`Code node "${filePath}": exported \`node\` must be an object literal`);
          }
          nodeObj = literalToValue(decl.initializer, filePath) as Record<string, unknown>;
        } else if (
          decl.name.text === 'run' &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          hasRun = true;
        }
      }
    }
  }

  return { node: nodeObj ?? {}, hasRun };
}

/** Convert a static TS literal expression (object/array/string/number/boolean/
 *  null) to its JS value. Non-literal expressions in code-node metadata throw. */
function literalToValue(node: ts.Expression, filePath: string): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => literalToValue(el, filePath));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Error(
          `Code node "${filePath}": \`node\` metadata must use plain \`key: value\` properties`,
        );
      }
      let key: string;
      if (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) key = prop.name.text;
      else throw new Error(`Code node "${filePath}": unsupported \`node\` metadata key`);
      obj[key] = literalToValue(prop.initializer, filePath);
    }
    return obj;
  }
  throw new Error(
    `Code node "${filePath}": \`node\` metadata values must be static literals (found ${ts.SyntaxKind[node.kind]})`,
  );
}

/**
 * Load a tasklist by name from the space.
 */
export async function loadTasklistFromSpace(space: Space, name: string): Promise<Record<string, TaskNode>> {
  const tasklistDir = space.tasklists[name];
  if (!tasklistDir) {
    throw new Error(`Tasklist "${name}" not found in space at "${space.dir}"`);
  }
  return loadTasklist(tasklistDir.slug, tasklistDir.files);
}
