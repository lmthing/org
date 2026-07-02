import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadSpace } from './load.js';
import { loadTasklistFromSpace } from './tasklist-load.js';
import type { Space, TasklistDir } from './load.js';
import type { TaskNode } from './tasklist-load.js';
import { validateDag, resolveGoalTask } from '../tasklist/dag.js';
import { splitPreludeStatements } from '../exec/prelude.js';
import { runTsc } from '../typecheck/tsc.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { buildAmbientDts } from '../exec/bootstrap.js';
import { forkCapabilities } from '../exec/capability.js';
import { evaluateDelegatePolicy } from '../exec/target-match.js';

/**
 * Structural guard for the shipped system spaces after the role/forEach/charter rewrite:
 * every system-space tasklist must load, validate as a DAG (incl. forEach refs), declare
 * exactly one resolvable goal, and every agent must ship a charter.md. Catches authoring
 * regressions (bad forEach ref, missing goal, dropped charter) without hitting a model.
 *
 * P6 additions: the `prelude:` sources of the migrated system-research / user-thing tasks
 * must parse into the expected statements AND typecheck against a fork-shaped ambient DTS
 * (the same one `runFork` builds) — the cheap static guarantee the preludes aren't typo'd.
 */

const SYS = resolve(__dirname, '..', '..', 'system-spaces');

/** The system-global space's function sources (webSearch/webFetch live there). */
async function globalFunctions(): Promise<Record<string, string>> {
  const g = await loadSpace(resolve(SYS, 'system-global'), { requireAgents: false });
  return g.functions;
}

/**
 * Rebuild the prelude's typecheck ambient exactly the way `fork.ts runFork` does:
 * fork capabilities from the task's role + canDelegateTo, the task's allowlisted
 * function overlay, NO currentTask (a prelude cannot resolve), and ambient `any`
 * declarations for the tasklist's declared input keys, the task's upstream
 * outputs (dependsOn ids), and forEach's `item`/`index`.
 */
function preludeAmbientFor(task: TaskNode, tl: TasklistDir, allFns: Record<string, string>): string {
  const policy = evaluateDelegatePolicy(task.canDelegateTo, 'task');
  const capabilities = forkCapabilities(task.role, policy.mode !== 'none');
  const picked: Record<string, string> = {};
  for (const name of task.functions ?? []) if (name in allFns) picked[name] = allFns[name]!;
  const overlay = Object.keys(picked).length > 0 ? buildOverlay(picked, { view: {}, form: {} }) : '';
  const seedDts = Object.keys(tl.input ?? {}).map((k) => `declare const ${k}: any;`).join('\n');
  const upstreamDts = (task.dependsOn ?? []).map((id) => `declare const ${id}: any;`).join('\n');
  const forEachDts = task.forEach ? 'declare const item: any;\ndeclare const index: number;' : '';
  return buildAmbientDts({
    capabilities,
    overlay,
    currentTask: false,
    extraDecls: [seedDts, upstreamDts, forEachDts].filter(Boolean),
  });
}

/** Typecheck each prelude statement in order, accumulating context like runPrelude does. */
function typecheckPrelude(task: TaskNode, tl: TasklistDir, allFns: Record<string, string>): void {
  const ambientDts = preludeAmbientFor(task, tl, allFns);
  const statements = splitPreludeStatements(task.prelude!);
  expect(statements.length, `${task.id} prelude statements`).toBeGreaterThan(0);
  let context = '';
  for (const stmt of statements) {
    const r = runTsc({ ambientDts, sessionContext: context, statement: stmt });
    const errs = r.ok ? '' : r.diagnostics.map((d) => d.message).join('; ');
    expect(r.ok, `${task.id} prelude statement typecheck failed:\n${stmt}\n→ ${errs}`).toBe(true);
    context += (context ? '\n' : '') + stmt;
  }
}

describe('shipped system spaces load + validate', () => {
  for (const name of ['system-architect', 'system-research', 'user-thing']) {
    it(`${name}: agents have charters and all tasklists are valid DAGs`, async () => {
      const space = await loadSpace(resolve(SYS, name), { requireAgents: false });
      // Every agent ships a non-trivial charter (fork-safe identity).
      for (const slug of Object.keys(space.agents)) {
        expect(space.agents[slug]!.charterBody.length, `${name}/${slug} charter`).toBeGreaterThan(20);
      }
      // Every tasklist validates and resolves a goal.
      for (const tlName of Object.keys(space.tasklists)) {
        const tasks = await loadTasklistFromSpace(space, tlName);
        expect(() => validateDag(tasks), `${name}/${tlName} DAG`).not.toThrow();
        expect(resolveGoalTask(tasks), `${name}/${tlName} goal`).toBeTruthy();
      }
    });
  }

  it('architect synthesize_and_run uses forEach fan-out with valid roles', async () => {
    const space = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    const tasks = await loadTasklistFromSpace(space, 'synthesize_and_run');
    // build_field / build_function fan out over the design step's arrays.
    expect(tasks['build_field']!.forEach).toBe('design.fields');
    expect(tasks['build_function']!.forEach).toBe('design.functions');
    // Read-only steps are explore; file-writing steps are general.
    expect(tasks['design']!.role).toBe('explore');
    expect(tasks['build_field']!.role).toBe('general');
    expect(tasks['validate']!.role).toBe('explore');
    // Every role is one of the three profiles.
    for (const t of Object.values(tasks)) {
      if (t.role) expect(['explore', 'plan', 'general']).toContain(t.role);
    }
  });

  it('architect tasklists declare input schemas matching what their callers pass', async () => {
    const space = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    // THING's build task / the architect instruct seed { topic, goal, research }.
    expect(space.tasklists['synthesize_and_run']!.input).toEqual({
      topic: 'string',
      goal: 'string',
      research: 'string',
    });
    // The architect instruct's Job 2 seeds { spaceKey, feedback }.
    expect(space.tasklists['iterate_space']!.input).toEqual({
      spaceKey: 'string',
      feedback: 'string',
    });
  });

  it('research agent exposes shallow research + deep_research (forEach) actions', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    // deep_research: scope (broad search) -> plan -> investigate (forEach) -> synthesize -> summarize.
    const deep = await loadTasklistFromSpace(space, 'deep_research');
    expect(deep['scope']!.role).toBe('explore');
    expect(deep['scope']!.functions).toEqual(['webSearch']);
    expect(deep['investigate']!.forEach).toBe('plan.questions');
    expect(deep['investigate_a']).toBeUndefined();
    // synthesize clusters/dedupes but is no longer the goal — summarize writes the final report.
    expect(deep['synthesize']!.goal).toBeFalsy();
    expect(resolveGoalTask(deep)!.id).toBe('summarize');
    // research: a single shallow quick-answer task.
    const shallow = await loadTasklistFromSpace(space, 'research');
    expect(Object.keys(shallow)).toEqual(['answer']);
    expect(resolveGoalTask(shallow)!.id).toBe('answer');
  });
});

describe('user-thing build_specialist (structural build pipeline)', () => {
  async function load(): Promise<{ space: Space; tasks: Record<string, TaskNode> }> {
    const space = await loadSpace(resolve(SYS, 'user-thing'), { requireAgents: false });
    const tasks = await loadTasklistFromSpace(space, 'build_specialist');
    return { space, tasks };
  }

  it('is a valid 2-task DAG (optional research → build goal) with the declared input schema', async () => {
    const { space, tasks } = await load();
    expect(() => validateDag(tasks)).not.toThrow();
    expect(Object.keys(tasks).sort()).toEqual(['build', 'research']);
    expect(space.tasklists['build_specialist']!.input).toEqual({ request: 'string' });

    const research = tasks['research']!;
    expect(research.optional).toBe(true);
    expect(research.role).toBe('explore');
    expect(research.functions).toEqual([]);
    expect(research.output).toEqual({ report: 'object' });
    expect(research.canDelegateTo).toEqual(['system-research/researcher#deep_research']);

    const build = tasks['build']!;
    expect(build.goal).toBe(true);
    expect(resolveGoalTask(tasks)!.id).toBe('build');
    expect(build.dependsOn).toEqual(['research']);
    expect(build.role).toBe('general');
    expect(build.functions).toEqual([]);
    expect(build.canDelegateTo).toEqual(['system-architect/architect#synthesize_and_run']);
  });

  it("build's output schema mirrors the architect finalize task field-for-field", async () => {
    const { tasks } = await load();
    const architect = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    const synth = await loadTasklistFromSpace(architect, 'synthesize_and_run');
    expect(tasks['build']!.output).toEqual(synth['finalize']!.output);
  });

  it("research's prelude performs the delegation itself and typechecks against the fork ambient", async () => {
    const { space, tasks } = await load();
    const research = tasks['research']!;
    expect(research.prelude).toBeTruthy();
    const stmts = splitPreludeStatements(research.prelude!);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain("await delegate('system-research', 'researcher', 'deep_research'");
    typecheckPrelude(research, space.tasklists['build_specialist']!, {});
  });
});

describe('system-research preludes (deterministic gather moved to the host)', () => {
  it('every gather task ships a prelude with the expected statements; pure-reasoning tasks do not', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    const deep = await loadTasklistFromSpace(space, 'deep_research');
    const shallow = await loadTasklistFromSpace(space, 'research');

    // scope: topic + 2 searches.
    expect(splitPreludeStatements(deep['scope']!.prelude ?? '')).toHaveLength(3);
    // investigate: question + search + top + 3 fetches.
    expect(splitPreludeStatements(deep['investigate']!.prelude ?? '')).toHaveLength(6);
    // synthesize: mechanical aggregation (entries/seedSources/rawSources/all_sources/
    // combined_findings/gap_notes) — kills the 'sourceMap is not defined' improvisation.
    const synthStmts = splitPreludeStatements(deep['synthesize']!.prelude ?? '');
    expect(synthStmts).toHaveLength(6);
    expect(deep['synthesize']!.prelude).toContain('all_sources');
    // answer: q + search + top + 1 fetch.
    expect(splitPreludeStatements(shallow['answer']!.prelude ?? '')).toHaveLength(4);
    // Pure-reasoning tasks carry NO prelude.
    expect(deep['plan']!.prelude).toBeUndefined();
    expect(deep['summarize']!.prelude).toBeUndefined();
  });

  it('every system-research prelude typechecks statement-by-statement against its fork ambient', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    const allFns = await globalFunctions();
    expect(Object.keys(allFns)).toContain('webSearch');
    expect(Object.keys(allFns)).toContain('webFetch');

    for (const tlName of ['deep_research', 'research']) {
      const tl = space.tasklists[tlName]!;
      const tasks = await loadTasklistFromSpace(space, tlName);
      for (const task of Object.values(tasks)) {
        if (!task.prelude) continue;
        typecheckPrelude(task, tl, allFns);
      }
    }
  });
});
