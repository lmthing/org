import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runDelegate } from './delegate.js';
import { DelegateRegistry } from './registry.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { Space, AgentDef } from '../spaces/load.js';
import { loadSystemSpaces, defaultSystemSpaceDirs } from '../spaces/system.js';
import { createMockStreamFn, mockMatch } from '../testing/mock-provider.js';
import { Tracer, type TraceEvent } from '../sandbox/trace.js';

/**
 * Delegate depth guard. runDelegate refuses to recurse past maxDepth — the check
 * fires before any space is loaded, so a runaway delegate chain is bounded. The
 * happy-path + nested (A→B) chain is covered end-to-end in
 * testing/harness-features.test.ts; here we pin the cap itself.
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => '', log: () => {} };
const emptyStream = async (): Promise<StreamSession> => ({
  textStream: (async function* () {})(),
  abort() {},
});

describe('runDelegate depth cap', () => {
  it('throws when depth has reached maxDepth (before loading the target)', async () => {
    const registry = new DelegateRegistry(new Map()); // empty: proves we never reach resolution
    await expect(
      runDelegate({
        packageName: 'pkg',
        agentName: 'agent',
        action: 'act',
        registry,
        renderHost: silentHost,
        streamFn: emptyStream,
        depth: 5,
        maxDepth: 5,
        maxConcurrentForks: 4,
      }),
    ).rejects.toThrow(/Maximum delegation depth \(5\) exceeded/);
  });

  it('the error names the unresolved target', async () => {
    const registry = new DelegateRegistry(new Map());
    await expect(
      runDelegate({
        packageName: 'somePkg',
        agentName: 'someAgent',
        action: 'go',
        registry,
        renderHost: silentHost,
        streamFn: emptyStream,
        depth: 3,
        maxDepth: 3,
        maxConcurrentForks: 4,
      }),
    ).rejects.toThrow(/somePkg\/someAgent/);
  });
});

/**
 * Regression: a delegate VM must have the universal `global` toolkit in BOTH the
 * typecheck overlay and the injected runtime — not just the runtime. The `memory`
 * system agent declares no functions of its own and calls `recallAll()` directly;
 * before the fix the overlay was built from the agent's declared functions only, so
 * the statement failed typecheck with "Cannot find name 'recallAll'", never resolved,
 * and the delegate returned undefined. (Found via the THING → memory delegation.)
 */
describe('runDelegate exposes the global toolkit to declared-functionless agents', () => {
  it('the memory agent can call recallAll() (typechecks + injects)', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const memory = systemSpaces.find((s) => s.dir.endsWith('/user-memory'));
    expect(memory, 'memory system space should load').toBeTruthy();

    const registry = new DelegateRegistry(new Map([[memory!.dir, memory!]]));
    // The "model" calls a universal global tool and resolves with its result. If
    // recallAll were missing from the overlay this statement would fail typecheck and
    // the result would never be captured (→ undefined).
    const streamFn = createMockStreamFn(
      () => `const r = recallAll();\ncurrentTask.resolve({ ok: r.ok, isObject: typeof r.facts === 'object' });`,
    );

    const result = (await runDelegate({
      packageName: memory!.dir,
      agentName: 'memory',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
    })) as { ok: boolean; isObject: boolean } | undefined;

    expect(result).toEqual({ ok: true, isObject: true });
  });
});

/**
 * A delegation's inputs are recorded on its trace node so a downstream ledger can
 * report "with what inputs" it was made. runDelegate writes a truncated preview of
 * `delegateOpts.query` into the delegate `node_start` detail.
 */
describe('runDelegate records the query input on its trace node', () => {
  it('the delegate node_start detail carries the query preview', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const memory = systemSpaces.find((s) => s.dir.endsWith('/user-memory'));
    expect(memory).toBeTruthy();
    const registry = new DelegateRegistry(new Map([[memory!.dir, memory!]]));
    const streamFn = createMockStreamFn(() => `currentTask.resolve({ ok: true });`);

    const tracer = new Tracer(null);
    const starts: Extract<TraceEvent, { type: 'node_start' }>[] = [];
    tracer.subscribe((e) => { if (e.type === 'node_start' && e.kind === 'delegate') starts.push(e); });

    await runDelegate({
      packageName: memory!.dir,
      agentName: 'memory',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
      tracer,
      delegateOpts: { query: 'remember my birthday' },
    });

    expect(starts).toHaveLength(1);
    expect(starts[0]!.detail?.query).toBe('remember my birthday');
    expect(starts[0]!.detail?.agent).toBe('memory');
  });
});

describe('runDelegate forced-resolve nudge (E4 live finding)', () => {
  it('a model-driven delegate that finishes without resolving gets resolve-only turns instead of returning undefined', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const memory = systemSpaces.find((s) => s.dir.endsWith('/user-memory'));
    expect(memory).toBeTruthy();
    const registry = new DelegateRegistry(new Map([[memory!.dir, memory!]]));

    let nudged = false;
    const streamFn = createMockStreamFn((o) => {
      const last = [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      if (last.includes('currentTask.resolve()')) {
        // The STOP nudge — NOW resolve.
        nudged = true;
        return `currentTask.resolve({ done: true, via: 'nudge' });`;
      }
      // Main run: do work, display, and end WITHOUT resolving (the live E4 engineer shape).
      return `display("did the work but forgot to resolve");`;
    });

    const result = (await runDelegate({
      packageName: memory!.dir,
      agentName: 'memory',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
    })) as { done: boolean; via: string } | undefined;

    expect(nudged).toBe(true);
    expect(result).toEqual({ done: true, via: 'nudge' });
  });
});

/**
 * Action-restriction enforcement (WP-3 / org/format/space/agents/delegation.md). A `canDelegateTo` entry with
 * a `#action` suffix (e.g. "helper#greet") resolves to a `ResolvedDep` whose
 * `allowedActions` gates which action ids may be delegated. `runDelegate` is the
 * enforcement point: it rejects a disallowed action up front (before loading the
 * target's VM) and lets an allowed one proceed normally.
 */
describe('runDelegate action-restriction (allowedActions)', () => {
  function fakeAgent(slug: string, actions: { id: string }[]): AgentDef {
    return {
      slug,
      title: slug,
      instructBody: '',
      charterBody: '',
      actions: actions.map((a) => ({ id: a.id, label: a.id, description: '', tasklist: '' })),
      canDelegateTo: [],
      config: { knowledge: [], functions: [], components: [] },
    };
  }

  function fakeSpace(dir: string, agents: Record<string, AgentDef>): Space {
    return {
      dir,
      packageName: undefined,
      agents,
      tasklists: {},
      functions: {},
      functionsBundled: {},
      dependentSpaces: {},
      components: { view: {}, form: {} },
      knowledge: { domains: {} },
    } as Space;
  }

  it('throws naming the allowed actions when the requested action is disallowed', async () => {
    const helper = fakeAgent('helper', [{ id: 'greet' }, { id: 'farewell' }]);
    const space = fakeSpace('/fake/space', { helper });
    const registry = new DelegateRegistry(new Map([['/fake/space', space]]));

    await expect(
      runDelegate({
        packageName: '/fake/space',
        agentName: 'helper',
        action: 'farewell',
        allowedActions: ['greet'],
        registry,
        renderHost: silentHost,
        streamFn: emptyStream,
        depth: 0,
        maxDepth: 5,
        maxConcurrentForks: 4,
      }),
    ).rejects.toThrow(/does not allow action "farewell".*allowed actions: greet/);
  });

  it('allows a permitted action through to the model-driven run', async () => {
    const helper = fakeAgent('helper', [{ id: 'greet' }, { id: 'farewell' }]);
    const space = fakeSpace('/fake/space2', { helper });
    const registry = new DelegateRegistry(new Map([['/fake/space2', space]]));
    const streamFn = createMockStreamFn(() => `currentTask.resolve("hi");`);

    const result = await runDelegate({
      packageName: '/fake/space2',
      agentName: 'helper',
      action: 'greet',
      allowedActions: ['greet'],
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    });

    expect(result).toBe('hi');
  });

  it('undefined allowedActions means unrestricted (no-action model-driven call passes)', async () => {
    const helper = fakeAgent('helper', [{ id: 'greet' }]);
    const space = fakeSpace('/fake/space3', { helper });
    const registry = new DelegateRegistry(new Map([['/fake/space3', space]]));
    const streamFn = createMockStreamFn(() => `currentTask.resolve("ok");`);

    const result = await runDelegate({
      packageName: '/fake/space3',
      agentName: 'helper',
      // no action — model-driven; no allowedActions — unrestricted.
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    });

    expect(result).toBe('ok');
  });
});

/**
 * Slice B lockstep pin (`.issues/research-store-noop-diagnosis.md`): webSearch/webFetch are
 * GRANTED-ONLY at the top level (filterUniversalFunctions in spaces/system.ts) — withheld from
 * a delegate's injected functions/overlay unless its own `functions:` frontmatter names them,
 * even though they remain in the UNFILTERED fork-engine pool a task node can still select (see
 * delegate.ts's poolFunctions / session.ts's forkFunctionPool). No shipped agent grants them
 * today (main's call, 2026-07-20 — confirmed by grep that neither THING nor the researcher calls
 * webSearch/webFetch at top level; both route through delegation/tasklists whose task nodes carry
 * their own `functions:` allow-list resolving from the pool) — this fixture proves the MECHANISM
 * generally, independent of which shipped agent (if any) ever opts in.
 */
describe('runDelegate — webSearch/webFetch are granted-only for the top-level VM (Slice B)', () => {
  function specialistAgent(functions: string[]): AgentDef {
    return {
      slug: 'specialist',
      title: 'Specialist',
      instructBody: '',
      charterBody: '',
      actions: [],
      canDelegateTo: [],
      config: { knowledge: [], functions, components: [] },
    };
  }

  function specialistSpace(dir: string, agent: AgentDef): Space {
    return {
      dir,
      packageName: undefined,
      agents: { specialist: agent },
      tasklists: {},
      functions: {},
      functionsBundled: {},
      dependentSpaces: {},
      components: { view: {}, form: {} },
      knowledge: { domains: {} },
    } as Space;
  }

  it('functions: [] — a top-level `webSearch(...)` call is UNRESOLVED (typecheck failure, retryable)', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const agent = specialistAgent([]); // no grant
    const space = specialistSpace('/fake/no-grant', agent);
    const registry = new DelegateRegistry(new Map([[space.dir, space]]));

    const retryPrompts: string[] = [];
    const streamFn = createMockStreamFn((o, ctx) => {
      if (ctx.callIndex === 0) return `await webSearch("x");`;
      // Every subsequent call is a RETRY turn — capture what the model was shown, then
      // stop cleanly so the run doesn't burn all 3 retries or trip the forced-resolve nudge.
      const last = [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      retryPrompts.push(last);
      return `currentTask.resolve({ retried: true });`;
    });

    const result = (await runDelegate({
      packageName: space.dir,
      agentName: 'specialist',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
    })) as { retried: boolean } | undefined;

    // The turn loop retried (webSearch never bound/resolved on the first attempt) and the
    // retry prompt names webSearch as an unrecognized identifier — a typecheck failure, not
    // a runtime throw (a granted-only function absent from the overlay fails typecheck, just
    // like any other undeclared identifier).
    expect(retryPrompts.length).toBeGreaterThan(0);
    expect(retryPrompts[0]).toMatch(/webSearch/);
    expect(retryPrompts[0]).toMatch(/Cannot find name/);
    expect(result).toEqual({ retried: true });
  });

  it('functions: ["webSearch"] — referencing `webSearch` at top level RESOLVES (no typecheck retry)', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const agent = specialistAgent(['webSearch']); // granted
    const space = specialistSpace('/fake/granted', agent);
    const registry = new DelegateRegistry(new Map([[space.dir, space]]));

    let sawTypecheckRetry = false;
    const streamFn = createMockStreamFn((o, ctx) => {
      const last = [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      if (last.includes('Cannot find name')) sawTypecheckRetry = true;
      if (ctx.callIndex === 0) {
        // The assertion is that the identifier RESOLVES (declared + typechecks) — not a
        // fully-stubbed real search result (main's call: don't over-engineer a fetch stub
        // here). Referencing it without calling it is enough to prove no retry occurs.
        return `currentTask.resolve({ kind: typeof webSearch });`;
      }
      return '';
    });

    const result = (await runDelegate({
      packageName: space.dir,
      agentName: 'specialist',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
    })) as { kind: string } | undefined;

    expect(sawTypecheckRetry).toBe(false);
    expect(result).toEqual({ kind: 'function' });
  });
});

/**
 * Auto-capture early-stop fix (`.issues/research-store-noop-diagnosis.md`, cause (a)):
 * before this fix, `onTasklistResult` captured + STOPPED the delegate's turn loop the
 * INSTANT the action's own tasklist resolved, regardless of what the result said. That
 * broke the "probe tasklist, escalate on a field in its result" pattern used by
 * `household-utility-advisor`-shaped specialists: `answer` resolves `{covered:false}`,
 * and the model's OWN prose plan is to then run `research_and_store` and resolve THAT
 * result instead — but the loop was already torn down before the model's next turn ever
 * got a chance to run (`shouldStop` is checked at the TOP of the turn loop's next cycle,
 * before a new LLM request is even issued — see turn-loop.ts's `shouldStop` doc comment).
 *
 * The fix: the FIRST resolution of a capturable tasklist is stashed as a fallback only
 * — it does not stop the loop. Only an EXPLICIT `currentTask.resolve()` (unchanged,
 * `currentTaskResolve`) or a SECOND resolution of the SAME tasklist name (a stuck-loop
 * re-emission — the model re-running it without ever calling `currentTask.resolve()`)
 * is terminal.
 */
const escalationTmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(escalationTmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** A specialist with ONE action ("answer") whose tasklist resolves `{covered}`, plus a
 *  SECOND, differently-named tasklist ("research_and_store") the action's own prose
 *  plan escalates to when `covered` is false. Mirrors the real
 *  `household-utility-advisor` shape at the level that matters for this bug: two
 *  DISTINCT tasklist names, only the first ("answer") is in `capturableTasklists`. */
async function makeEscalationSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-delegate-escalate-'));
  escalationTmpDirs.push(dir);
  const agentFile = join(dir, 'agents', 'specialist', 'instruct.md');
  await mkdir(dirname(agentFile), { recursive: true });
  await writeFile(
    agentFile,
    `---\ntitle: Specialist\nactions:\n  - id: answer\n    label: Answer\n    description: Answer, escalating to research when not covered\n    tasklist: answer\n---\n\nYou are a specialist.\n`,
    'utf8',
  );
  const answerTask = join(dir, 'tasklists', 'answer', '01-check.md');
  await mkdir(dirname(answerTask), { recursive: true });
  await writeFile(
    answerTask,
    `---\nid: check\ngoal: true\noutput:\n  covered: boolean\n---\n\nANSWER_TASK: check whether the knowledge base covers this question.`,
    'utf8',
  );
  const researchTask = join(dir, 'tasklists', 'research_and_store', '01-research.md');
  await mkdir(dirname(researchTask), { recursive: true });
  await writeFile(
    researchTask,
    `---\nid: research\ngoal: true\noutput:\n  stored: boolean\n  source: string\n---\n\nRESEARCH_TASK: research the web and store findings.`,
    'utf8',
  );
  return dir;
}

/** Same discriminator harness-features.test.ts's `forkRule` uses: "Output schema:" only
 *  appears in a fork/tasklist-task prompt, never in the delegate's own top-level turn —
 *  so matching on it (plus a token unique to the node's instruction) cleanly separates
 *  task-node turns from the delegate's own turns without relying on call ordering. */
function taskRule(token: string, respond: (o: StreamOpts) => string) {
  return {
    when: (o: StreamOpts) => o.messages.some((m) => m.content.includes('Output schema:') && m.content.includes(token)),
    respond,
  };
}

describe('runDelegate auto-capture — two-tasklist escalation pattern (research-store-noop fix)', () => {
  it('returns the SECOND (research_and_store) result, not the first (answer) tasklist result', async () => {
    const dir = await makeEscalationSpace();
    const registry = new DelegateRegistry(new Map());
    let delegateTurn = 0;
    const streamFn = mockMatch(
      [
        taskRule('ANSWER_TASK', () => `currentTask.resolve({ covered: false });`),
        taskRule('RESEARCH_TASK', () => `currentTask.resolve({ stored: true, source: 'srcX' });`),
      ],
      () => {
        delegateTurn++;
        // Turn 1: probe. Turn 2 (only reachable if the loop did NOT stop after the
        // 'answer' tasklist resolved): read covered===false and escalate. Turn 3:
        // resolve with the research result.
        if (delegateTurn === 1) return `const r = await tasklist("answer", { query, ...context });`;
        if (delegateTurn === 2) return `const r2 = await tasklist("research_and_store", { query, ...context });`;
        if (delegateTurn === 3) return `currentTask.resolve(r2);`;
        return '';
      },
    );

    const result = (await runDelegate({
      packageName: dir,
      agentName: 'specialist',
      action: 'answer',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    })) as { ok: boolean; degraded: boolean; data: { stored: boolean; source: string } } | undefined;

    // Pre-fix, delegateTurn would stop at 1 (shouldStop tore the loop down the instant
    // 'answer' resolved) and `result` would be the 'answer' envelope, not the research one.
    expect(delegateTurn).toBe(3);
    expect(result?.data).toEqual({ stored: true, source: 'srcX' });
  });

  it('re-emission of the SAME capturable tasklist (no explicit resolve — the stuck-loop case) is terminal: stops after the 2nd, no 3rd call', async () => {
    const dir = await makeEscalationSpace();
    const registry = new DelegateRegistry(new Map());
    let forkCallCount = 0;
    let delegateTurn = 0;
    const streamFn = mockMatch(
      [
        taskRule('ANSWER_TASK', () => {
          forkCallCount++;
          return `currentTask.resolve({ covered: false, attempt: ${forkCallCount} });`;
        }),
      ],
      () => {
        delegateTurn++;
        // The model never calls currentTask.resolve() — it just keeps re-running the
        // SAME tasklist every turn (the stuck-loop pattern the re-emission rule guards).
        return `const r = await tasklist("answer", { query, ...context });`;
      },
    );

    const result = (await runDelegate({
      packageName: dir,
      agentName: 'specialist',
      action: 'answer',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    })) as { ok: boolean; degraded: boolean; data: { covered: boolean; attempt: number } } | undefined;

    expect(forkCallCount).toBe(2); // the tasklist ran exactly twice
    expect(delegateTurn).toBe(2); // no 3rd delegate-level turn — the loop stopped after the re-emission
    expect(result?.data).toEqual({ covered: false, attempt: 2 }); // the LATEST result, not the discarded 1st
  });

  it('a normal single-tasklist delegate: the model reads the result and resolves explicitly on the NEXT turn', async () => {
    const dir = await makeEscalationSpace();
    const registry = new DelegateRegistry(new Map());
    let delegateTurn = 0;
    const streamFn = mockMatch(
      [taskRule('ANSWER_TASK', () => `currentTask.resolve({ covered: true });`)],
      () => {
        delegateTurn++;
        if (delegateTurn === 1) return `const r = await tasklist("answer", { query, ...context });`;
        // Reading r.data.covered here proves the loop did NOT stop after the first
        // (fallback-only) capture — the model got to see the bound result and act on it.
        if (delegateTurn === 2) return `currentTask.resolve({ final: true, covered: (r as any).data.covered });`;
        return '';
      },
    );

    const result = (await runDelegate({
      packageName: dir,
      agentName: 'specialist',
      action: 'answer',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    })) as { final: boolean; covered: boolean } | undefined;

    expect(delegateTurn).toBe(2);
    expect(result).toEqual({ final: true, covered: true });
  });
});

/**
 * A DELEGATED agent runs its own action tasklists through the delegate's yield router, which
 * builds its own context — so `codeNodeCtxFactory` has to be threaded in explicitly. It was not,
 * and the consequences were worse than a clean failure.
 *
 * Observed live (06-tanzania run 33): the appbuilder's `build_live_project` ran all the way
 * through `implement_pages`, then its `verify` code node died with "no codeNodeCtxFactory was
 * provided". The required task failed, the tasklist threw — and the automator answered the error
 * by ABANDONING the pipeline: "The tasklist code-node runner isn't available in this session —
 * I'll build the app directly." Every gate the tasklist exists to enforce was skipped, and the
 * app was hand-built instead. A missing wire became a silent bypass of the whole build contract.
 */
async function makeCodeNodeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-delegate-codenode-'));
  escalationTmpDirs.push(dir);
  const agentFile = join(dir, 'agents', 'builder', 'instruct.md');
  await mkdir(dirname(agentFile), { recursive: true });
  await writeFile(
    agentFile,
    `---\ntitle: Builder\nactions:\n  - id: build\n    label: Build\n    description: Build the thing\n    tasklist: build\n---\n\nYou are a builder.\n`,
    'utf8',
  );
  const gate = join(dir, 'tasklists', 'build', '01-gate.ts');
  await mkdir(dirname(gate), { recursive: true });
  await writeFile(
    gate,
    `export const node = { id: 'gate', goal: true, output: { ok: 'boolean' } };\nexport async function run() { return {}; }\n`,
    'utf8',
  );
  return dir;
}

describe('runDelegate threads codeNodeCtxFactory into the delegate’s own tasklists', () => {
  it('runs a code node in a delegated action tasklist when the parent supplies a factory', async () => {
    const dir = await makeCodeNodeSpace();
    let ran = false;
    const streamFn = mockMatch([], (): string => `const r = await tasklist("build", { query });`);

    const result = (await runDelegate({
      packageName: dir,
      agentName: 'builder',
      action: 'build',
      registry: new DelegateRegistry(new Map()),
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      codeNodeCtxFactory: () => ({
        runCodeNode: async () => {
          ran = true;
          return { ok: true };
        },
      }),
    })) as { ok: boolean; data: { ok: boolean } } | undefined;

    expect(ran, 'the code node must actually execute inside the delegate').toBe(true);
    expect(result?.data).toEqual({ ok: true });
  });

  it('without a factory the code node fails — the regression this guards', async () => {
    const dir = await makeCodeNodeSpace();
    let sawError = false;
    const streamFn = mockMatch([], (): string => {
      // The delegate's turn: run the tasklist and surface whatever it throws.
      return `try { await tasklist("build", { query }); } catch (e) { currentTask.resolve({ failed: String(e) }); }`;
    });

    await runDelegate({
      packageName: dir,
      agentName: 'builder',
      action: 'build',
      registry: new DelegateRegistry(new Map()),
      renderHost: { ...silentHost, log: (m: string) => { if (/codeNodeCtxFactory/.test(String(m))) sawError = true; } },
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      // codeNodeCtxFactory deliberately omitted
    }).catch((e: unknown) => {
      if (/codeNodeCtxFactory/.test(String(e))) sawError = true;
    });

    expect(sawError, 'omitting the factory must still fail loudly, not silently no-op').toBe(true);
  });
});
