import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadSpace } from './load.js';
import { runTasklist } from '../tasklist/orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Mock end-to-end coverage for P6's design guarantee: `user-thing`'s
 * `build_specialist` tasklist ALWAYS runs the build step, even when the
 * upstream research task degrades/salvages
 * (.issues/thing-abandons-build-on-salvaged-research.md /
 * .issues/investigate-forks-degrade-under-delegate-nesting.md — the exact
 * failure mode this tasklist shape was built to route around structurally).
 *
 * Runs the REAL shipped `libs/core/system-spaces/user-thing/tasklists/
 * build_specialist` files through the real orchestrator + ForkEngine, with a
 * scripted `streamFn` standing in for the model and a scripted
 * `delegateRunner` standing in for the real `system-research` / `system-architect`
 * spaces (those are exercised by other e2e tests — this test isolates the
 * "degraded upstream doesn't abort downstream" DAG behavior).
 *
 * Degrading the `research` task: its prelude ALREADY performs the
 * `delegate('system-research', 'researcher', 'deep_research', …)` call (see
 * `01-research.md`) — the model's only job is a single
 * `currentTask.resolve({ report: … })` statement. Returning `''` for every one
 * of the research fork's turns (initial + the 2 forced resolve-nudge turns)
 * means the model NEVER calls resolve, so `fork.ts`'s guarantee kicks in: it
 * salvages a NEUTRAL schema-valid placeholder (`{ report: {} }`, reason
 * `no_resolve`) rather than throwing — this is the established
 * "mock model never resolves" salvage pattern used by
 * `tasklist/delegate-in-task.test.ts`.
 */

const SYS = resolve(__dirname, '..', '..', 'system-spaces');
const USER_THING_DIR = resolve(SYS, 'user-thing');
const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

// Markers unique to each task's instruction body (see the real .md files) —
// robust against wording tweaks elsewhere in the file, since these are the
// exact contract sentences the task files are built around.
const RESEARCH_MARKER = 'Package the domain research for the build step.';
const BUILD_MARKER = "Hand the user's `request`";

describe('build_specialist mock e2e: degraded research → build still runs', () => {
  it('salvages the optional research task but still delegates the build task to the architect, producing a schema-shaped (non-prose) TaskEnvelope', async () => {
    const space = await loadSpace(USER_THING_DIR, { requireAgents: false });

    const delegateCalls: Array<{ pkg: string; agent: string; action?: string }> = [];
    let buildTurn = 0;

    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const text = o.system + '\n' + o.messages.map((m) => m.content).join('\n');

      if (text.includes(RESEARCH_MARKER)) {
        // The research fork's model never resolves on ANY of its turns (initial
        // call + 2 forced resolve-nudges) — forces fork.ts's salvage path.
        return '';
      }

      if (text.includes(BUILD_MARKER)) {
        buildTurn++;
        if (buildTurn === 1) {
          // Mirrors 02-build.md's first statement verbatim.
          return `const t = await delegate('system-architect', 'architect', 'synthesize_and_run', { query: String(request), context: { topic: String(request), goal: String(request), research: (research && research.report) ? research.report : {} } });`;
        }
        // Mirrors 02-build.md's packaging + resolve statements verbatim.
        return [
          'const built = (t && t.data) ? t.data : { spaceKey: "", agentSlug: "", actionId: "", query: "", ok: false, errors: "the architect returned no result" };',
          'currentTask.resolve({ spaceKey: String(built.spaceKey || ""), agentSlug: String(built.agentSlug || ""), actionId: String(built.actionId || ""), query: String(built.query || request), ok: !!(t && t.ok === true && built.ok === true), errors: String(built.errors || "") });',
        ].join('\n');
      }

      throw new Error(`unexpected fork prompt (no marker matched):\n${text.slice(0, 300)}`);
    });

    const engine = new ForkEngine({
      maxConcurrentForks: 2,
      parentHistory: [],
      parentSpaceDir: USER_THING_DIR,
      parentAgentSlug: 'thing',
      renderHost: silentHost,
      streamFn,
      delegateRunner: async (pkg, agent, action) => {
        delegateCalls.push({ pkg, agent, action });
        if (pkg === 'system-research' && agent === 'researcher' && action === 'deep_research') {
          // Stand-in for a degraded researcher run (the real failure mode in
          // the linked .issues/ — the report comes back empty/salvaged).
          // Neutral/schema-shaped per exec/envelope.ts, never prose.
          return { ok: false, degraded: true, data: {}, reason: 'no_resolve', degradedTasks: ['scope', 'investigate[0]'] };
        }
        if (pkg === 'system-architect' && agent === 'architect' && action === 'synthesize_and_run') {
          return {
            ok: true,
            degraded: false,
            data: { spaceKey: 'user/dog-expert', agentSlug: 'dog-expert', actionId: 'answer', query: 'a dog breed helper', ok: true, errors: '' },
          };
        }
        throw new Error(`unexpected delegate target in mock: ${pkg}/${agent}#${action}`);
      },
    });

    const env = await runTasklist({
      name: 'build_specialist',
      space,
      forkEngine: engine,
      seed: { request: 'a dog breed helper' },
    });

    // (a) The build task's delegate to the architect was actually reached —
    // proof the DAG did not short-circuit after the research task salvaged.
    expect(delegateCalls).toContainEqual({ pkg: 'system-architect', agent: 'architect', action: 'synthesize_and_run' });
    // The research task's prelude-driven delegate ran too (host-executed,
    // before the model's first turn — independent of the model ever resolving).
    expect(delegateCalls).toContainEqual({ pkg: 'system-research', agent: 'researcher', action: 'deep_research' });

    // (b) TaskEnvelope signals the degradation in the CONTROL plane: the
    // research task (never resolved by the mock model) is listed as salvaged.
    expect(env.degraded).toBe(true);
    expect(env.degradedTasks).toContain('research');

    // The build task itself resolved cleanly (mock architect delegate
    // succeeded) — the overall run is `ok`, even though a task salvaged.
    expect(env.ok).toBe(true);

    // (c) `data` is schema-shaped, never prose: exactly the build task's
    // declared output fields, with real (non-empty, non-placeholder) values,
    // and — the whole point of Phase 3's envelope redesign — no alarming
    // "(unavailable …)" placeholder text anywhere in the data plane.
    const data = env.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['actionId', 'agentSlug', 'errors', 'ok', 'query', 'spaceKey']);
    expect(data).toEqual({
      spaceKey: 'user/dog-expert',
      agentSlug: 'dog-expert',
      actionId: 'answer',
      query: 'a dog breed helper',
      ok: true,
      errors: '',
    });
    for (const v of Object.values(data)) {
      if (typeof v === 'string') expect(v.toLowerCase()).not.toContain('unavailable');
    }
  });
});
