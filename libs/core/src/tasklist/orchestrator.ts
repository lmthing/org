import type { Space } from '../spaces/load.js';
import type { ForkEngine } from '../fork/fork.js';
import { loadTasklist } from '../spaces/tasklist-load.js';
import { validateDag, findReadyTasks, resolveGoalTask, resumeSet, ancestorsOf } from './dag.js';
import { evaluateCondition } from './condition-dsl.js';
import type { TaskNode } from '../spaces/tasklist-load.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { validateInput } from './schema.js';
import type { TaskEnvelope, DegradeReason } from '../exec/envelope.js';
import { salvageData } from '../exec/envelope.js';

/** How many times a single forEach ELEMENT is retried (fresh fork) before its value is salvaged.
 *  A failing element (bad resolve, thrown error, VM error) must never sink the whole required task —
 *  one flaky specialist build shouldn't block the app build — so each element gets its own retries. */
const FOREACH_ITEM_ATTEMPTS = 3;

/** Default `onFail.maxAttempts`: how many times a failed check may resume an earlier step
 *  before the pipeline gives up and runs on to its goal task (which reports the residual
 *  failure honestly). Bounded so a check that can never be satisfied cannot spin forever. */
const DEFAULT_ON_FAIL_ATTEMPTS = 2;

/** Resolve a `forEach` reference ("taskId" or "taskId.field.subfield") against accumulated
 *  task outputs. Returns the referenced array, or [] when missing / not an array. */
function resolveForEachItems(ref: string, allOutputs: Record<string, unknown>): unknown[] {
  const parts = ref.split('.');
  let val: unknown = allOutputs[parts[0]!];
  for (const part of parts.slice(1)) {
    if (val && typeof val === 'object') val = (val as Record<string, unknown>)[part];
    else { val = undefined; break; }
  }
  return Array.isArray(val) ? val : [];
}

/**
 * Execution context for ONE `kind:'code'` tasklist node, built by the host
 * (CLI/pod) — never by core. `runCodeNode` loads + runs the node module's
 * `run(ctx, inputs)` in a Node worker with a `ctx` gated by the space/tasklist
 * `connections:` (db, callConnection, delegate). `inputs` is the SAME data an
 * agent fork of this node would receive: the seed-filtered tasklist input merged
 * with upstream task outputs (keyed by dependency id), plus `item`/`index` for a
 * forEach element. The returned object feeds `allOutputs`/`TaskEnvelope` exactly
 * like an agent node's output.
 */
export interface CodeNodeContext {
  runCodeNode(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Maps a code node to its {@link CodeNodeContext}. Injected via
 * {@link RunTasklistOptions} by the CLI/pod (the headless tasklist runner, plan
 * step S9); the in-session yield-router threads one built from the session's
 * project scope when available. When ABSENT, encountering a code node fails that
 * task with a clear error (required-task-failure semantics) — core cannot
 * execute node modules itself. Called once per code node (before any forEach
 * fan-out), so the host can build per-node state up front.
 */
export type CodeNodeCtxFactory = (node: TaskNode) => CodeNodeContext;

/**
 * A snapshot of a tasklist run at a `kind:'checkpoint'` barrier: the tasks
 * completed so far and their raw outputs. The host persists it (a durable
 * "last green" marker) and can hand it back as {@link RunTasklistOptions.resume}
 * so a crashed/interrupted run skips the work already done. Core keeps NO
 * filesystem — persistence is entirely the host's, exactly like
 * {@link CodeNodeCtxFactory}.
 */
export interface CheckpointSnapshot {
  /** The tasklist this checkpoint belongs to (a subgraph reports its own name). */
  tasklist: string;
  /** The checkpoint node's id. */
  id: string;
  /** Ids of every task done at this point (schedule order not guaranteed). */
  done: string[];
  /** Each done task's raw output, keyed by task id. */
  outputs: Record<string, unknown>;
}

export type CheckpointHook = (cp: CheckpointSnapshot) => void | Promise<void>;

export interface RunTasklistOptions {
  name: string;
  space: Space;
  forkEngine: ForkEngine;
  seed?: Record<string, unknown>;
  tracer?: Tracer;
  parentScope?: TraceScope;
  /** Host-provided runner for `kind:'code'` nodes (see {@link CodeNodeCtxFactory}).
   *  Omit outside a CLI/pod context — code nodes then fail as required-task errors. */
  codeNodeCtxFactory?: CodeNodeCtxFactory;
  /** Called when a `kind:'checkpoint'` node runs, with a {@link CheckpointSnapshot}.
   *  Propagated into subgraphs so a nested checkpoint persists too. Omit to make
   *  checkpoint nodes plain no-op barriers. */
  onCheckpoint?: CheckpointHook;
  /** Pre-populate completed tasks + their outputs from a persisted checkpoint, so a
   *  resumed run skips work already done. Only the top-level run resumes; subgraphs
   *  always run fresh. A task id not present in this tasklist is ignored. */
  resume?: { done?: string[]; outputs?: Record<string, unknown> };
  /** Internal recursion guard: the chain of tasklist names currently on the stack.
   *  A `subgraph` node naming a tasklist already on the stack is a cycle and fails
   *  loudly. Set by the orchestrator when it descends into a subgraph — callers
   *  leave it undefined. */
  stack?: string[];
}

/**
 * Run a tasklist DAG and return a `TaskEnvelope` wrapping the goal task's output.
 *
 * Task→task UPSTREAM outputs stay RAW schema data (task files keep referencing
 * `plan.questions` etc.) — degradation metadata never leaks into upstream
 * variable values. Only the tasklist BOUNDARY result is enveloped:
 * `{ ok, degraded, data, reason?, degradedTasks? }`.
 */

/**
 * Upstream outputs are keyed by dependency id (`{ user_stories: { stories: [...] } }`), but a node's
 * `input:` names bare FIELDS (`stories: array`). Flatten one level so both forms validate — a field
 * emitted by exactly one dependency is visible unqualified; a name two dependencies both emit stays
 * ambiguous and is deliberately NOT flattened, so the node must qualify it.
 */
function flattenForInput(upstream: Record<string, unknown>): Record<string, unknown> {
  const counts = new Map<string, number>();
  for (const out of Object.values(upstream)) {
    if (!out || typeof out !== 'object' || Array.isArray(out)) continue;
    for (const k of Object.keys(out as Record<string, unknown>)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const flat: Record<string, unknown> = {};
  for (const out of Object.values(upstream)) {
    if (!out || typeof out !== 'object' || Array.isArray(out)) continue;
    for (const [k, v] of Object.entries(out as Record<string, unknown>)) {
      if (counts.get(k) === 1) flat[k] = v;
    }
  }
  return flat;
}

export async function runTasklist(opts: RunTasklistOptions): Promise<TaskEnvelope> {
  const { name, space, forkEngine, seed, tracer, parentScope, codeNodeCtxFactory, onCheckpoint, resume } = opts;

  // Recursion guard: a subgraph naming a tasklist already on the call stack would
  // recurse forever. Fail loudly with the full cycle rather than blow the stack.
  const stack = opts.stack ?? [];
  if (stack.includes(name)) {
    throw new Error(
      `Subgraph cycle detected: tasklist "${name}" is already running (stack: ${[...stack, name].join(' → ')})`,
    );
  }
  const callStack = [...stack, name];

  const tasklistDir = space.tasklists[name];
  if (!tasklistDir) {
    throw new Error(`Tasklist "${name}" not found in space`);
  }

  // Validate the runtime seed against the tasklist's declared input schema
  // (tasklists/<name>/index.md frontmatter). No declared schema → accept any seed.
  const declaredInputKeys =
    tasklistDir.input && Object.keys(tasklistDir.input).length > 0
      ? Object.keys(tasklistDir.input)
      : undefined;
  if (declaredInputKeys) {
    const errors = validateInput(tasklistDir.input!, seed ?? {});
    if (errors.length > 0) {
      throw new Error(
        `Tasklist "${name}" received an invalid seed:\n  - ${errors.join('\n  - ')}`,
      );
    }
  }

  // INPUT HARD FILTER: when the tasklist declares an `input` schema, forks receive
  // ONLY the declared keys — whatever extra baggage a delegator packed into the seed
  // (e.g. `parentHistory`, stray context) never rides into leaf prompts/ambient DTS.
  // This makes a leaf fork's prompt a pure function of (task file, declared inputs,
  // upstream outputs, forEach item) — identical shallow vs nested. No declared
  // schema → full passthrough (back-compat). Host-injected forEach `item`/`index`
  // are added AFTER the filter and are unaffected.
  const taskSeed = declaredInputKeys
    ? Object.fromEntries(Object.entries(seed ?? {}).filter(([k]) => declaredInputKeys.includes(k)))
    : seed;

  const tasks = await loadTasklist(tasklistDir.slug, tasklistDir.files);
  validateDag(tasks);
  const goalTask = resolveGoalTask(tasks);

  // Fail fast on an unresolvable / self-recursive subgraph target rather than mid-run:
  // a typo'd sub-tasklist name should read as an authoring error, not a task failure.
  for (const task of Object.values(tasks)) {
    if (task.kind !== 'subgraph') continue;
    const sub = task.subgraph!;
    if (!space.tasklists[sub]) {
      throw new Error(
        `Task "${task.id}" is a subgraph of "${sub}", which is not a tasklist in this space`,
      );
    }
    if (callStack.includes(sub)) {
      throw new Error(
        `Task "${task.id}" subgraph "${sub}" would recurse into a tasklist already running (stack: ${[...callStack, sub].join(' → ')})`,
      );
    }
  }

  // Mint a tasklist node so the tree shows this orchestration scope
  const tasklistScope = tracer && parentScope
    ? tracer.child(parentScope, 'tasklist', `tasklist:${name}`, { tasklist: name })
    : undefined;

  const done = new Set<string>();
  const skipped = new Set<string>();
  const allOutputs: Record<string, unknown> = {};
  let goalOutput: unknown;

  // Resume from a persisted checkpoint: mark the recorded tasks done and restore
  // their outputs, so `findReadyTasks` never re-offers work already committed.
  // Unknown ids (a tasklist edited since the checkpoint) are ignored — the run
  // simply redoes those nodes. If the goal itself was already done, seed its output.
  if (resume) {
    for (const id of resume.done ?? []) {
      if (tasks[id]) done.add(id);
    }
    for (const [id, out] of Object.entries(resume.outputs ?? {})) {
      if (tasks[id] && done.has(id)) allOutputs[id] = out;
    }
    if (goalTask && done.has(goalTask.id)) goalOutput = allOutputs[goalTask.id];
  }
  // Degradation aggregation (Phase 3): labels of every salvaged task / forEach
  // element (e.g. "investigate[3]"), plus the goal task's own degradation state.
  const degradedTasks: string[] = [];
  let goalDegraded = false;
  let goalReason: DegradeReason | undefined;

  // onFail bookkeeping: how many resumes each checker has spent, and the reason payload
  // handed to each node a resume re-opened. `feedback` cannot travel through
  // getUpstreamOutputs (the resumed node is UPSTREAM of the checker — depending on it
  // would be a cycle), so it rides in on the seed instead.
  const onFailAttempts = new Map<string, number>();
  const resumeFeedback = new Map<string, Record<string, unknown>>();

  /** The seed a task runs with: the filtered tasklist seed plus any resume feedback. */
  function seedFor(task: TaskNode): Record<string, unknown> | undefined {
    const fb = resumeFeedback.get(task.id);
    if (!fb) return taskSeed;
    return { ...(taskSeed ?? {}), ...fb };
  }

  // Build up upstream outputs per task
  function getUpstreamOutputs(task: TaskNode): Record<string, unknown> {
    const upstream: Record<string, unknown> = {};
    for (const dep of task.dependsOn ?? []) {
      if (allOutputs[dep] !== undefined) {
        upstream[dep] = allOutputs[dep];
      }
    }
    return upstream;
  }

  // Declared output schema per upstream dependency, so each `declare const <dep>` in the
  // fork's typecheck overlay gets a real type. A `forEach` dependency is flagged isArray —
  // its collected value is an array of its output shape (see fork.ts taskOutputDts).
  function getUpstreamOutputSchemas(task: TaskNode): Record<string, { fields: Record<string, string>; isArray: boolean }> {
    const schemas: Record<string, { fields: Record<string, string>; isArray: boolean }> = {};
    for (const dep of task.dependsOn ?? []) {
      const depTask = tasks[dep];
      if (depTask) schemas[dep] = { fields: depTask.output, isArray: Boolean(depTask.forEach) };
    }
    return schemas;
  }

  // Emit a `task` node and immediately end it as skipped (condition not met /
  // optional fork failed). Tracks via `skippedEmitted` so we never double-emit.
  const skippedEmitted = new Set<string>();
  const emitSkip = (task: TaskNode): void => {
    if (!tracer || !tasklistScope || skippedEmitted.has(task.id)) return;
    skippedEmitted.add(task.id);
    const s = tracer.child(tasklistScope, 'task', `fork:${task.id}`, {
      tasklist: name, dependsOn: task.dependsOn, optional: task.optional, condition: task.condition, goal: task.goal,
    });
    tracer.end(s, 'skipped');
  };

  /** Node ids a condition reads — `verify.ok == false` → `verify`. The DSL is `<id>.<field> <op>
   *  <literal>`, so the identifier before a dot is the whole grammar we need here. */
  const conditionSources = (when: string): string[] =>
    [...when.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\./g)].map((m) => m[1] as string);

  /** Gates already re-measured, so the terminal pass happens at most once per onFail task. */
  const terminalRemeasured = new Set<string>();

  /**
   * The TERMINAL RE-MEASURE — the last repair round must not go unjudged.
   *
   * When `onFail`'s predicate reads a node OTHER than the task itself, that node is an ancestor
   * (the task depends on the gate it is repairing), so its recorded value was computed BEFORE
   * this repair round. `build_live_project` is exactly this shape: `fix.onFail =
   * {goto: verify, when: 'verify.ok == false'}`, and `fix` depends on `verify`. Every round
   * therefore judges a repair by a measurement taken before it, and when the budget runs out the
   * pipeline hands its goal task a gate value that predates the final `fix` batch — so a run that
   * needs exactly `maxAttempts` rounds can NEVER report success, however clean the app ends up.
   * Measured live: `verify` ran 4×, `finalize` resolved `ok:false`, and a standalone re-run of the
   * same gate against the finished project returned `{ok: true, errorCount: 0, checked: 4}`.
   *
   * So on exhaustion we re-run the GATE ONLY — not `resumeSet`, which would re-run the repair step
   * too and hand out an unbudgeted extra attempt. The repair nodes stay `done`, the gate re-runs
   * against the app as it now IS, and the goal task judges that. No feedback is carried: this is a
   * measurement, not another attempt.
   *
   * The default topology (`when` reads the task itself, e.g. `check.onFail = {goto: design}`) is
   * untouched — there the check re-runs itself on every resume, so its value is never stale and
   * `sources` contains only the task, which this skips.
   */
  const terminalRemeasure = (task: TaskNode, when: string): void => {
    if (terminalRemeasured.has(task.id)) return;
    const forebears = ancestorsOf(tasks, task.id);
    const gates = conditionSources(when).filter(
      (id) => id !== task.id && forebears.has(id) && tasks[id] && done.has(id),
    );
    if (gates.length === 0) return;
    terminalRemeasured.add(task.id);
    for (const id of gates) {
      done.delete(id);
      skipped.delete(id);
      skippedEmitted.delete(id);
      delete allOutputs[id];
      resumeFeedback.delete(id);
    }
  };

  /**
   * `onFail`: when this node's check fails, un-do the stretch back to `goto` so it re-runs,
   * carrying WHY it failed. Purely scheduler-level — `dependsOn` is never mutated, so the
   * DAG stays acyclic and `findReadyTasks` re-offers the body on the next wave (its own
   * dependencies are still `done`).
   *
   * Budget-exhausted resumes deliberately DO NOT throw: the pipeline continues to its goal
   * task, which reports the residual failure honestly. A silent extra pass is worse than a
   * loud partial result.
   */
  const maybeResume = (task: TaskNode, output: unknown): void => {
    if (!task.onFail) return;
    // Default predicate matches the gate convention: a check resolves `ok`. The DSL cannot
    // index arrays, so this is always a scalar comparison (see condition-dsl getAtPath).
    const when = task.onFail.when ?? `${task.id}.ok == false`;
    let failed = false;
    try {
      failed = evaluateCondition(when, allOutputs);
    } catch {
      return; // an unparseable predicate must not wedge the pipeline into a resume loop
    }
    if (!failed) return;

    const spent = onFailAttempts.get(task.id) ?? 0;
    const budget = task.onFail.maxAttempts ?? DEFAULT_ON_FAIL_ATTEMPTS;
    if (spent >= budget) {
      terminalRemeasure(task, when);
      return;
    }
    onFailAttempts.set(task.id, spent + 1);

    const carried =
      task.onFail.carry && output && typeof output === 'object'
        ? (output as Record<string, unknown>)[task.onFail.carry]
        : output;

    for (const id of resumeSet(tasks, task.onFail.goto, task.id)) {
      done.delete(id);
      skipped.delete(id);
      skippedEmitted.delete(id);
      delete allOutputs[id];
      resumeFeedback.set(id, { feedback: carried, attempt: spent + 1 });
    }
  };

  // Scopes and in-flight work outlive one iteration: a task launched now can settle several
  // iterations later, so neither may be re-minted per pass.
  const taskScopes = new Map<string, TraceScope | undefined>();
  type Settled =
    | { id: string; ok: true; value: { task: TaskNode; output: unknown } }
    | { id: string; ok: false; reason: unknown };
  const inflight = new Map<string, Promise<Settled>>();

  try {
    // ROLLING, not wave-barrier. The previous loop awaited `Promise.allSettled` over every ready
    // task and committed nothing until the slowest finished — so a node started at *max(finish of
    // the whole previous wave)* rather than max of its own dependencies, and `implement_endpoints`
    // (which needs only `checkpoint_tables`) waited on an unrelated multi-fork fan-out that happened
    // to share a wave. Each task's output is now committed the moment it settles and readiness is
    // re-evaluated immediately.
    //
    // Safe against `onFail`: `resumeSet` un-does `goto`, the failing node, and the tasks between
    // them — all of which are ancestors of the failing node, hence necessarily already complete. No
    // in-flight task can be in that set, so a resume cannot double-launch running work. Pinned by
    // "a resume does not disturb an in-flight sibling" in orchestrator.onfail.test.ts.
    while (done.size + skipped.size < Object.keys(tasks).length) {
      // Never relaunch something already running — the whole point of re-evaluating mid-flight.
      const ready = findReadyTasks(tasks, done, skipped, allOutputs).filter((t) => !inflight.has(t.id));

      if (ready.length === 0 && inflight.size === 0) {
        // Check if there are tasks remaining but none are ready (stuck)
        const remaining = Object.keys(tasks).filter((id) => !done.has(id) && !skipped.has(id));
        if (remaining.length > 0) {
          // Skip tasks whose conditions aren't met
          for (const id of remaining) {
            const task = tasks[id]!;
            const deps = task.dependsOn ?? [];
            const depsOk = deps.every((dep) => done.has(dep) || skipped.has(dep));
            if (depsOk && (task.optional || task.condition)) {
              // Condition not met (or optional with unmet deps) — skip + trace it.
              skipped.add(id);
              emitSkip(task);
            }
          }

          // Check if we're truly stuck
          const stillRemaining = Object.keys(tasks).filter(
            (id) => !done.has(id) && !skipped.has(id),
          );
          if (stillRemaining.length === remaining.length) {
            throw new Error(`Tasklist "${name}" is stuck: tasks ${stillRemaining.join(', ')} cannot be resolved`);
          }
        }
        continue;
      }

      // Launch everything newly ready, then wait for the FIRST to settle rather than all of them.
      const launch = async (task: TaskNode) => {
          const upstreamOutputs = getUpstreamOutputs(task);
          const upstreamOutputSchemas = getUpstreamOutputSchemas(task);
          const taskScope = tracer && tasklistScope
            ? tracer.child(tasklistScope, 'task', `fork:${task.id}`, {
                tasklist: name, dependsOn: task.dependsOn, optional: task.optional, condition: task.condition, goal: task.goal, forEach: task.forEach,
              })
            : undefined;
          taskScopes.set(task.id, taskScope);

          const upstream = Object.keys(upstreamOutputs).length > 0 ? upstreamOutputs : undefined;

          // A node's own `input:` schema is a CONTRACT over what its dependencies must have
          // produced — enforce it, fail-loud, before the node runs. It was parsed
          // (`spaces/tasklist-load.ts`) and then read by nothing, so a node could declare an
          // input its upstream never emits and still run, receiving `undefined` and failing
          // somewhere further on with an error that named the wrong node. Dead contract metadata
          // is worse than none: it reads as a guarantee.
          if (task.input && Object.keys(task.input).length > 0) {
            const seen = { ...(seedFor(task) ?? {}), ...upstreamOutputs, ...flattenForInput(upstreamOutputs) };
            const inputErrors = validateInput(task.input, seen);
            if (inputErrors.length > 0) {
              throw new Error(
                `Task "${task.id}" input contract unmet: ${inputErrors.join('; ')}. ` +
                  `Declared \`input:\` names what this node's dependencies (${(task.dependsOn ?? []).join(', ') || 'none'}) ` +
                  'must supply — either the upstream output schema changed, or this node depends on the wrong task.',
              );
            }
          }

          // CODE NODE: the host runs the node module's `run(ctx, inputs)` via the
          // injected factory (core stays free of any transpile/worker runtime).
          // Inputs mirror exactly what an agent fork of this node would see —
          // the seed-filtered tasklist input merged with upstream outputs (keyed
          // by dependency id), plus `item`/`index` for a forEach element. Output
          // feeds allOutputs/TaskEnvelope identically to an agent node. A code
          // node has no salvage path: `run` either returns (success) or throws
          // (→ required-task failure below, or skip when optional). forEach can
          // fan out over a code node, and a code node can be a forEach body.
          if (task.kind === 'code') {
            if (!codeNodeCtxFactory) {
              throw new Error(
                `Code node "${task.id}" cannot run here: no codeNodeCtxFactory was provided to ` +
                  `runTasklist. The CLI/pod injects one (headless tasklist runner); an in-session ` +
                  `run needs that runner wired. Core does not execute code-node modules itself.`,
              );
            }
            const codeCtx = codeNodeCtxFactory(task);
            const baseInputs: Record<string, unknown> = { ...(seedFor(task) ?? {}), ...upstreamOutputs };
            if (task.forEach) {
              const items = resolveForEachItems(task.forEach, allOutputs);
              const output = await Promise.all(
                items.map((item, index) => {
                  const elemScope = tracer && taskScope
                    ? tracer.child(taskScope, 'task', `code:${task.id}[${index}]`, { tasklist: name, forEachIndex: index })
                    : undefined;
                  return codeCtx.runCodeNode({ ...baseInputs, item, index }).then((val) => {
                    if (tracer && elemScope) tracer.end(elemScope, 'done', { result: val });
                    return val;
                  });
                }),
              );
              return { task, output };
            }
            const output = await codeCtx.runCodeNode(baseInputs);
            return { task, output };
          }

          // forkWithMeta: same execution path as fork(), plus typed degradation
          // metadata so salvage becomes a control-plane signal (→ TaskEnvelope),
          // not prose inside the data.
          const runFork = (
            extraSeed?: Record<string, unknown>,
            elemScope?: TraceScope,
          ): Promise<import('../fork/fork.js').ForkResultMeta> =>
            forkEngine.forkWithMeta({
              instruction: task.instruction,
              output: task.output,
              seed: extraSeed ? { ...(seedFor(task) ?? {}), ...extraSeed } : seedFor(task),
              upstreamOutputs: upstream,
              upstreamOutputSchemas,
              taskId: task.id,
              role: task.role,
              model: task.model,
              functions: task.functions,
              canDelegateTo: task.canDelegateTo,
              capabilities: task.capabilities as import('../spaces/capabilities.js').CapabilityId[] | undefined,
              prelude: task.prelude,
              tasklistDescription: tasklistDir.description,
              parentScope: elemScope ?? taskScope,
            });

          // Record a salvage for the given label; when this is the goal task, its
          // (first) degradation also determines the envelope's ok/reason.
          const noteDegraded = (label: string, reason: DegradeReason | undefined): void => {
            degradedTasks.push(label);
            if (goalTask && task.id === goalTask.id) {
              goalDegraded = true;
              if (!goalReason) goalReason = reason ?? 'no_resolve';
            }
          };

          // CHECKPOINT NODE: a barrier that records a durable "last green" marker.
          // It runs no fork and produces a fixed `{ ok, checkpoint }`; its whole
          // effect is to hand the host a snapshot of everything done so far (this
          // node included) so a crashed run can resume past it. With no onCheckpoint
          // hook it is a plain no-op barrier — still useful as a DAG join point.
          if (task.kind === 'checkpoint') {
            const output: Record<string, unknown> = { ok: true, checkpoint: task.id };
            if (onCheckpoint) {
              await onCheckpoint({
                tasklist: name,
                id: task.id,
                done: [...done, task.id],
                outputs: { ...allOutputs, [task.id]: output },
              });
            }
            return { task, output };
          }

          // SUBGRAPH NODE: run a named sub-tasklist (recursively, same engine) and
          // unwrap its TaskEnvelope.data as this node's output. Seeded exactly like a
          // code node — the filtered tasklist seed merged with upstream outputs, plus
          // `item`/`index` when this node also has `forEach` (fan a whole sub-DAG out
          // over a runtime-produced array — the slice-per-item pipeline). A degraded
          // sub-run folds up: its `ok:false` degrades this node, and its inner
          // degradedTasks are re-labelled `<thisId>/<inner>` so the boundary envelope
          // still names every salvage. The call stack (checked above) prevents cycles.
          if (task.kind === 'subgraph') {
            const subName = task.subgraph!;
            const baseSeed: Record<string, unknown> = { ...(seedFor(task) ?? {}), ...upstreamOutputs };
            const runSub = (extra?: Record<string, unknown>, scope?: TraceScope): Promise<TaskEnvelope> =>
              runTasklist({
                name: subName,
                space,
                forkEngine,
                seed: extra ? { ...baseSeed, ...extra } : baseSeed,
                tracer,
                parentScope: scope ?? taskScope,
                codeNodeCtxFactory,
                onCheckpoint,
                stack: callStack,
              });
            const foldSub = (env: TaskEnvelope, label: string): unknown => {
              if (!env.ok) noteDegraded(label, env.reason);
              for (const inner of env.degradedTasks ?? []) degradedTasks.push(`${label}/${inner}`);
              return env.data;
            };
            if (task.forEach) {
              const items = resolveForEachItems(task.forEach, allOutputs);
              const output = await Promise.all(
                items.map(async (item, index) => {
                  const elemScope = tracer && taskScope
                    ? tracer.child(taskScope, 'task', `subgraph:${task.id}[${index}]`, { tasklist: name, forEachIndex: index })
                    : undefined;
                  const env = await runSub({ item, index }, elemScope);
                  const data = foldSub(env, `${task.id}[${index}]`);
                  if (tracer && elemScope) tracer.end(elemScope, 'done', { result: data, ...(env.ok ? {} : { degraded: true, reason: env.reason }) });
                  return data;
                }),
              );
              return { task, output };
            }
            const env = await runSub();
            const output = foldSub(env, task.id);
            return { task, output };
          }

          // forEach: host-driven fan-out. Resolve the referenced upstream array and run the
          // task once per element (parallel, within the engine's concurrency cap), injecting
          // the element as `item` (+ `index`). Collect the resolved values into an array.
          if (task.forEach) {
            const items = resolveForEachItems(task.forEach, allOutputs);
            // Each element is independent: if its fork FAILS (off-schema resolve, thrown error, VM
            // error), retry the SAME element with a FRESH fork up to FOREACH_ITEM_ATTEMPTS times
            // (a transient VM error usually clears on a clean fork; the model gets more tries at a
            // valid resolve). Only after the last attempt fails do we salvage a schema-valid neutral
            // placeholder for THAT element — so one bad item never rejects the collection and sinks
            // the whole (required) task; the goal always runs.
            const output = await Promise.all(
              items.map(async (item, index) => {
                const elemScope = tracer && taskScope
                  ? tracer.child(taskScope, 'task', `fork:${task.id}[${index}]`, { tasklist: name, forEachIndex: index })
                  : undefined;
                let lastErr: unknown;
                for (let attempt = 1; attempt <= FOREACH_ITEM_ATTEMPTS; attempt++) {
                  try {
                    const meta = await runFork({ item, index }, elemScope);
                    if (meta.degraded) noteDegraded(`${task.id}[${index}]`, meta.reason);
                    if (tracer && elemScope) tracer.end(elemScope, 'done', { result: meta.value, ...(meta.degraded ? { degraded: true, reason: meta.reason } : {}) });
                    return meta.value;
                  } catch (err) {
                    lastErr = err;
                  }
                }
                const salvagedValue = salvageData(task.output);
                noteDegraded(`${task.id}[${index}]`, 'no_resolve');
                if (tracer && elemScope) tracer.end(elemScope, 'error', { error: lastErr instanceof Error ? lastErr.message : String(lastErr) });
                return salvagedValue;
              }),
            );
            return { task, output };
          }

          const meta = await runFork();
          if (meta.degraded) noteDegraded(task.id, meta.reason);
          return { task, output: meta.value };
      };

      for (const task of ready) {
        inflight.set(
          task.id,
          launch(task).then(
            (value): Settled => ({ id: task.id, ok: true, value }),
            (reason): Settled => ({ id: task.id, ok: false, reason }),
          ),
        );
      }

      // Wait for the first task to settle, commit it, and loop — so a node whose dependencies are
      // already satisfied starts immediately instead of waiting on an unrelated slow sibling.
      const settled = await Promise.race(inflight.values());
      inflight.delete(settled.id);

      if (settled.ok) {
        const { task, output } = settled.value;
        done.add(task.id);
        allOutputs[task.id] = output;
        if (tracer) { const ts = taskScopes.get(task.id); if (ts) tracer.end(ts, 'done', { result: output }); }
        if (goalTask && task.id === goalTask.id) goalOutput = output;
        maybeResume(task, output);
      } else {
        const failedTask = tasks[settled.id]!;
        const ts = taskScopes.get(failedTask.id);
        if (failedTask.optional) {
          skipped.add(failedTask.id);
          skippedEmitted.add(failedTask.id);
          if (tracer && ts) tracer.end(ts, 'skipped');
        } else {
          const errMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
          if (tracer && ts) tracer.end(ts, 'error', { error: errMsg });
          // Work still running is abandoned, exactly as the wave scheduler abandoned the rest of its
          // wave. Attach a no-op catch so an abandoned rejection is never an unhandled one.
          for (const p of inflight.values()) void p.catch(() => {});
          throw new Error(`Required task "${failedTask.id}" failed: ${errMsg}`);
        }
      }
    }

    // A skipped goal task means the pipeline short-circuited — an upstream
    // condition was not met — and produced NO result. Returning `undefined`
    // here would surface to the caller as a silent `null` delegate result with
    // no explanation (the exact failure that left the architect returning null).
    // Fail loudly instead, folding in any upstream `errors`/`error` fields so the
    // model sees WHY (e.g. a validation failure) and can react.
    if (goalTask && skipped.has(goalTask.id)) {
      const diagnostics = Object.entries(allOutputs)
        .map(([id, out]) => {
          if (out && typeof out === 'object') {
            const err = (out as Record<string, unknown>).errors ?? (out as Record<string, unknown>).error;
            if (typeof err === 'string' && err.trim()) return `${id}: ${err.trim()}`;
          }
          return null;
        })
        .filter((d): d is string => d !== null);
      const detail = diagnostics.length > 0 ? ` Upstream errors — ${diagnostics.join('; ')}` : '';
      throw new Error(
        `Tasklist "${name}" produced no result: its goal task "${goalTask.id}" was skipped ` +
          `because an upstream condition was not met.${detail}`,
      );
    }

    // Wrap the goal output in a TaskEnvelope at the tasklist BOUNDARY:
    //   ok        — the goal task itself resolved un-salvaged
    //   degraded  — any salvage occurred anywhere in the DAG (incl. forEach elements)
    //   data      — the goal task's RAW schema output (salvaged fields are neutral empties)
    // Hard failures (stuck DAG, invalid seed, skipped goal, budget/timeout rejects)
    // still THROW above — they surface as retryable yield errors, unchanged.
    const envelope: TaskEnvelope = {
      ok: !goalDegraded,
      degraded: degradedTasks.length > 0,
      data: goalOutput,
      ...(goalDegraded ? { reason: goalReason ?? 'no_resolve' } : {}),
      ...(degradedTasks.length > 0 ? { degradedTasks } : {}),
    };
    if (tracer && tasklistScope) tracer.end(tasklistScope, 'done', { result: envelope });
    return envelope;
  } catch (err) {
    if (tracer && tasklistScope) tracer.end(tasklistScope, 'error', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
