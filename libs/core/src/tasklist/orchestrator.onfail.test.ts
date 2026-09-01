import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist } from './orchestrator.js';
import type { CodeNodeCtxFactory } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * `onFail`: a failed check resumes an EARLIER step, carrying why it failed.
 *
 * The point of the feature is the carry — a retry that re-runs blind just repeats the
 * same mistake — so the central assertion here is that attempt 2 SEES attempt 1's reason.
 * Code nodes drive every case so the checks are deterministic (no model in the loop).
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-onfail-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
  const tl = join(dir, 'tasklists', 'flow');
  await mkdir(tl, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(tl, name), contents, 'utf8');
  }
  return dir;
}

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

function engineFor(dir: string): ForkEngine {
  const streamFn = createMockStreamFn((_o: StreamOpts) => '');
  return new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: dir,
    parentAgentSlug: 'main',
    renderHost: silentHost,
    streamFn,
  });
}

/** Code-node factory over an in-memory { taskId -> run } map, recording every call's inputs. */
function factoryFrom(
  runners: Record<string, (inputs: Record<string, unknown>) => unknown>,
  calls: Array<{ id: string; inputs: Record<string, unknown> }> = [],
): CodeNodeCtxFactory {
  return (node) => ({
    runCodeNode: async (inputs) => {
      calls.push({ id: node.id, inputs });
      const fn = runners[node.id];
      if (!fn) throw new Error(`test: no runner for code node "${node.id}"`);
      return (await fn(inputs)) as Record<string, unknown>;
    },
  });
}

/** design → check(onFail → design) → done. `check` passes on its Nth attempt. */
async function flowThatPassesOnAttempt(passOn: number, maxAttempts?: number) {
  const budget = maxAttempts === undefined ? '' : `, maxAttempts: ${maxAttempts}`;
  const dir = await makeTasklistSpace({
    '01-design.ts': `export const node = { output: { spec: 'string' } };\nexport async function run() { return {}; }`,
    '02-check.ts': `export const node = { dependsOn: ['design'], output: { ok: 'boolean', errors: 'array' }, onFail: { goto: 'design', carry: 'errors'${budget} } };\nexport async function run() { return {}; }`,
    '03-done.ts': `export const node = { dependsOn: ['check'], goal: true, output: { finished: 'boolean' } };\nexport async function run() { return {}; }`,
  });
  const space = await loadSpace(dir);
  const calls: Array<{ id: string; inputs: Record<string, unknown> }> = [];
  let checkRuns = 0;
  const factory = factoryFrom(
    {
      design: (inputs) => ({ spec: `spec-attempt-${(inputs['attempt'] as number) ?? 0}` }),
      check: () => {
        checkRuns += 1;
        return checkRuns >= passOn
          ? { ok: true, errors: [] }
          : { ok: false, errors: [`broken-ref-${checkRuns}`] };
      },
      done: () => ({ finished: true }),
    },
    calls,
  );
  const result = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });
  return { result, calls, checkRuns };
}

/**
 * A sibling that is still RUNNING when a check fails must not be disturbed by the resume.
 *
 * `resumeSet` un-does `goto`, the failing node, and the tasks between them — i.e. only ancestors of
 * the failing node. Every ancestor of a task that just ran is necessarily already complete, so no
 * in-flight task can be in that set. This test pins that property, because it is what makes it safe
 * to commit each task as it settles instead of at end-of-wave: without it, a scheduler that
 * re-evaluates readiness mid-wave could launch a second copy of a node that is already running.
 */
describe('onFail — a resume does not disturb an in-flight sibling', () => {
  it('runs a slow unrelated branch exactly once across a resume', async () => {
    const dir = await makeTasklistSpace({
      '01-design.ts': `export const node = { output: { spec: 'string' } };\nexport async function run() { return {}; }`,
      // Depends on design, so it is READY at the same moment `check` is — and it takes long enough
      // that `check` settles first. It is on an unrelated branch, so `resumeSet` must leave it alone.
      '02-slow.ts': `export const node = { dependsOn: ['design'], output: { done: 'boolean' } };\nexport async function run() { return {}; }`,
      '03-check.ts': `export const node = { dependsOn: ['design'], output: { ok: 'boolean', errors: 'array' }, onFail: { goto: 'design', carry: 'errors' } };\nexport async function run() { return {}; }`,
      '04-done.ts': `export const node = { dependsOn: ['check', 'slow'], goal: true, output: { finished: 'boolean' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const calls: Array<{ id: string; inputs: Record<string, unknown> }> = [];
    let checkRuns = 0;
    let slowConcurrent = 0;
    let slowMaxConcurrent = 0;
    const factory = factoryFrom(
      {
        design: (inputs) => ({ spec: `spec-${(inputs['attempt'] as number) ?? 0}` }),
        slow: async () => {
          slowConcurrent += 1;
          slowMaxConcurrent = Math.max(slowMaxConcurrent, slowConcurrent);
          await new Promise((r) => setTimeout(r, 120));
          slowConcurrent -= 1;
          return { done: true };
        },
        check: () => {
          checkRuns += 1;
          return checkRuns >= 2 ? { ok: true, errors: [] } : { ok: false, errors: ['nope'] };
        },
        done: () => ({ finished: true }),
      },
      calls,
    );
    const result = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });

    expect(checkRuns).toBe(2); // failed once, then passed
    expect(calls.filter((c) => c.id === 'design')).toHaveLength(2); // design redone by the resume
    // The point: `slow` is NOT in the resume set, so it is neither re-run nor double-launched.
    expect(calls.filter((c) => c.id === 'slow')).toHaveLength(1);
    expect(slowMaxConcurrent).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('onFail — resume an earlier step carrying the reason', () => {
  it('resumes until the check passes, then continues to the goal', async () => {
    const { result, calls, checkRuns } = await flowThatPassesOnAttempt(3);

    expect(checkRuns).toBe(3); // failed twice, passed on the third
    expect(calls.filter((c) => c.id === 'design')).toHaveLength(3); // design redone each time
    expect(calls.filter((c) => c.id === 'done')).toHaveLength(1); // goal runs once, at the end
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ finished: true });
  });

  it('carries the failure reason into the resumed step as `feedback`', async () => {
    // THE point of the feature: attempt 2 must see attempt 1's errors, not re-run blind.
    const { calls } = await flowThatPassesOnAttempt(3);
    const designCalls = calls.filter((c) => c.id === 'design');

    expect(designCalls[0]!.inputs['feedback']).toBeUndefined(); // first pass: nothing to carry
    expect(designCalls[0]!.inputs['attempt']).toBeUndefined();

    expect(designCalls[1]!.inputs['feedback']).toEqual(['broken-ref-1']);
    expect(designCalls[1]!.inputs['attempt']).toBe(1);
    expect(designCalls[2]!.inputs['feedback']).toEqual(['broken-ref-2']);
    expect(designCalls[2]!.inputs['attempt']).toBe(2);
  });

  it('stops at maxAttempts and lets the pipeline finish rather than throwing', async () => {
    // A check that can never pass must not spin, and must not abort the run — the goal
    // task still reports honestly.
    const { result, checkRuns } = await flowThatPassesOnAttempt(Number.POSITIVE_INFINITY, 2);

    expect(checkRuns).toBe(3); // initial run + 2 resumes
    expect(result.ok).toBe(true); // the GOAL succeeded; the check's failure is its own output
    expect(result.data).toEqual({ finished: true });
  });

  it('defaults maxAttempts to 2 and the predicate to "<id>.ok == false"', async () => {
    // No `when:` and no `maxAttempts:` in the frontmatter above — both defaults apply.
    const { checkRuns } = await flowThatPassesOnAttempt(Number.POSITIVE_INFINITY);
    expect(checkRuns).toBe(3);
  });

  it('honours an explicit `when` predicate over the default', async () => {
    const dir = await makeTasklistSpace({
      '01-design.ts': `export const node = { output: { spec: 'string' } };\nexport async function run() { return {}; }`,
      '02-check.ts': `export const node = { dependsOn: ['design'], goal: true, output: { ok: 'boolean', grade: 'string' }, onFail: { goto: 'design', when: "check.grade == 'bad'", maxAttempts: 5 } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    let n = 0;
    const factory = factoryFrom({
      design: () => ({ spec: 's' }),
      // ok stays FALSE throughout: only `grade` drives the resume, proving the default
      // predicate was replaced rather than ANDed.
      check: () => ({ ok: false, grade: ++n < 3 ? 'bad' : 'good' }),
    });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });

    expect(n).toBe(3);
    expect(result.data).toEqual({ ok: false, grade: 'good' });
  });

  it('resets only the goto..node stretch, leaving unrelated branches done', async () => {
    // `sibling` is upstream of the goal but NOT between design and check, so a resume
    // must not re-run it.
    const dir = await makeTasklistSpace({
      '01-design.ts': `export const node = { output: { spec: 'string' } };\nexport async function run() { return {}; }`,
      '02-sibling.ts': `export const node = { output: { side: 'string' } };\nexport async function run() { return {}; }`,
      '03-check.ts': `export const node = { dependsOn: ['design'], output: { ok: 'boolean' }, onFail: { goto: 'design', maxAttempts: 3 } };\nexport async function run() { return {}; }`,
      '04-done.ts': `export const node = { dependsOn: ['check', 'sibling'], goal: true, output: { finished: 'boolean' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const calls: Array<{ id: string; inputs: Record<string, unknown> }> = [];
    let n = 0;
    const factory = factoryFrom(
      {
        design: () => ({ spec: 's' }),
        sibling: () => ({ side: 'untouched' }),
        check: () => ({ ok: ++n >= 2 }),
        done: () => ({ finished: true }),
      },
      calls,
    );
    await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });

    expect(calls.filter((c) => c.id === 'design')).toHaveLength(2); // in the reset stretch
    expect(calls.filter((c) => c.id === 'check')).toHaveLength(2);
    expect(calls.filter((c) => c.id === 'sibling')).toHaveLength(1); // NOT reset
    expect(calls.filter((c) => c.id === 'done')).toHaveLength(1);
  });

  it('carries the whole output when `carry` is omitted', async () => {
    const dir = await makeTasklistSpace({
      '01-design.ts': `export const node = { output: { spec: 'string' } };\nexport async function run() { return {}; }`,
      '02-check.ts': `export const node = { dependsOn: ['design'], goal: true, output: { ok: 'boolean', why: 'string' }, onFail: { goto: 'design', maxAttempts: 1 } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const calls: Array<{ id: string; inputs: Record<string, unknown> }> = [];
    let n = 0;
    const factory = factoryFrom(
      { design: () => ({ spec: 's' }), check: () => ({ ok: ++n >= 2, why: 'mismatch' }) },
      calls,
    );
    await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });

    const second = calls.filter((c) => c.id === 'design')[1]!;
    expect(second.inputs['feedback']).toEqual({ ok: false, why: 'mismatch' });
  });

  it('rejects a goto that is not a transitive dependency', async () => {
    const dir = await makeTasklistSpace({
      '01-a.ts': `export const node = { output: { v: 'string' } };\nexport async function run() { return {}; }`,
      '02-b.ts': `export const node = { output: { v: 'string' } };\nexport async function run() { return {}; }`,
      '03-check.ts': `export const node = { dependsOn: ['a'], goal: true, output: { ok: 'boolean' }, onFail: { goto: 'b' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const factory = factoryFrom({ a: () => ({ v: 'x' }), b: () => ({ v: 'y' }), check: () => ({ ok: true }) });

    await expect(
      runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory }),
    ).rejects.toThrow(/must be a task "check" transitively depends on/);
  });

  it('rejects a goto pointing at itself', async () => {
    const dir = await makeTasklistSpace({
      '01-a.ts': `export const node = { output: { v: 'string' } };\nexport async function run() { return {}; }`,
      '02-check.ts': `export const node = { dependsOn: ['a'], goal: true, output: { ok: 'boolean' }, onFail: { goto: 'check' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const factory = factoryFrom({ a: () => ({ v: 'x' }), check: () => ({ ok: true }) });

    await expect(
      runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory }),
    ).rejects.toThrow(/cannot resume from itself/);
  });
});

/**
 * The gate→repair topology, which is `build_live_project`'s: the `onFail` lives on the REPAIR node
 * and its predicate reads the GATE it depends on (`fix.onFail = {goto: verify, when:
 * "verify.ok == false"}`). Because the repair runs after the gate, every recorded gate value
 * predates the repair that answers it — so the last repair round used to go unjudged, and a run
 * needing exactly `maxAttempts` rounds could never report success however clean it ended up.
 */
describe('onFail — a gate the repair node depends on is re-measured at the end', () => {
  /** verify → fix(onFail → verify) → finalize. `verify` reports clean only after `fixRuns` repairs. */
  async function gateFlow(cleanAfterFixes: number, maxAttempts: number) {
    const dir = await makeTasklistSpace({
      '01-verify.ts': `export const node = { output: { ok: 'boolean', offending: 'array' } };\nexport async function run() { return {}; }`,
      '02-fix.ts': `export const node = { dependsOn: ['verify'], output: { ok: 'boolean' }, onFail: { goto: 'verify', when: "verify.ok == false", maxAttempts: ${maxAttempts} } };\nexport async function run() { return {}; }`,
      '03-finalize.ts': `export const node = { dependsOn: ['verify', 'fix'], goal: true, output: { shipped: 'boolean', gateSaid: 'boolean' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const calls: Array<{ id: string; inputs: Record<string, unknown> }> = [];
    let fixRuns = 0;
    let verifyRuns = 0;
    const factory = factoryFrom(
      {
        // The gate reads the world as the repairs have left it — clean once enough have run.
        verify: () => {
          verifyRuns += 1;
          const clean = fixRuns >= cleanAfterFixes;
          return { ok: clean, offending: clean ? [] : ['api/broken.ts'] };
        },
        fix: () => {
          fixRuns += 1;
          return { ok: true };
        },
        // The goal task judges the app by what the GATE last said — the real finalize's shape.
        finalize: (inputs) => ({
          shipped: (inputs['verify'] as { ok: boolean }).ok,
          gateSaid: (inputs['verify'] as { ok: boolean }).ok,
        }),
      },
      calls,
    );
    const result = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });
    return { result, calls, fixRuns, verifyRuns };
  }

  it('re-measures the gate after the LAST repair, so a run that needed every attempt can still pass', async () => {
    // 3 attempts, and the app only comes clean on the 4th repair — the exact live shape
    // (verify ran 4×, the final fix batch cleared it, finalize read the pre-fix snapshot).
    const { result, fixRuns, verifyRuns } = await gateFlow(4, 3);

    expect(fixRuns).toBe(4); // initial + 3 budgeted repairs
    expect(verifyRuns).toBe(5); // 4 in the loop + ONE terminal re-measure
    expect(result.data).toMatchObject({ gateSaid: true }); // judged as the app now IS
  });

  it('does not hand out an extra repair attempt — the terminal pass re-runs the gate ONLY', async () => {
    // The app never comes clean, so the re-measure must not become a 4th repair round.
    const { fixRuns, verifyRuns } = await gateFlow(Number.POSITIVE_INFINITY, 3);

    expect(fixRuns).toBe(4); // still initial + 3, NOT 5
    expect(verifyRuns).toBe(5);
  });

  it('re-measures at most once, and reports the residual failure honestly', async () => {
    const { result, verifyRuns } = await gateFlow(Number.POSITIVE_INFINITY, 1);

    expect(verifyRuns).toBe(3); // initial + 1 budgeted + 1 terminal
    expect(result.data).toMatchObject({ gateSaid: false }); // still broken, and it says so
  });

  it('leaves the self-checking topology alone — a check that re-runs itself is never stale', async () => {
    // `check.onFail = {goto: design}` with the DEFAULT predicate reads `check` itself, which has
    // just run, so there is nothing to re-measure and the pass must not fire.
    const { checkRuns } = await flowThatPassesOnAttempt(Number.POSITIVE_INFINITY, 2);
    expect(checkRuns).toBe(3); // unchanged: initial + 2 resumes, no extra run
  });
});
