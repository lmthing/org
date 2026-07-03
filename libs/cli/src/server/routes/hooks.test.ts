/**
 * Phase 6C — hook run endpoint + crontab sync + boot catch-up + fallback tick.
 *
 * 6A (`../../app/hooks/index.js`) is NOT merged when this suite is authored, so it
 * is `vi.mock`ed with a **minimal but behaviorally-real** shim that does REAL fs
 * against a tmp project (globs `hooks/*.ts`, reads/writes `hooks-state.json`, and
 * computes `dueCronHooks` from `every`/`lastFiredAt`). The production import in
 * `hooks.ts` is unchanged (`../../app/hooks/index.js`) — the integrator should
 * confirm the suite stays green against 6A's real pure fns (the one contract to
 * reconcile is the `lastFiredAt` field name; see hooks.ts INTEGRATION NOTE).
 *
 * `node:child_process` is mocked so no test ever touches a real crontab; the whole
 * suite also runs under `LM_NO_CRONTAB=1` (the guard), so `spawn`/`spawnSync` are
 * never even reached — asserted directly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock node:child_process (assert we never spawn under the guard) ───────────
const spawnMock = vi.fn<unknown[], unknown>();
const spawnSyncMock = vi.fn<unknown[], unknown>(() => ({ error: undefined }));
vi.mock('node:child_process', () => ({
  spawn: (...a: unknown[]) => spawnMock(...a),
  spawnSync: (...a: unknown[]) => spawnSyncMock(...a),
}));

// ── Minimal functional shim for 6A's ../../app/hooks/index.js ─────────────────
// Hoisted + self-contained: dynamic imports only, exports a shared __enrichCalls
// array the test can inspect (the enrich hook's handler pushes its ctx).
vi.mock('../../app/hooks/index.js', async () => {
  const { readdirSync, readFileSync, existsSync, writeFileSync } = await import('node:fs');
  const { join: pjoin, basename } = await import('node:path');

  const __enrichCalls: Array<Record<string, unknown>> = [];

  function parseEvery(s: string): number {
    const m = /^(\d+)([smhd])$/.exec(s.trim());
    if (!m) return 0;
    const n = Number(m[1]);
    const unit = m[2];
    return n * (unit === 's' ? 1e3 : unit === 'm' ? 6e4 : unit === 'h' ? 36e5 : 864e5);
  }

  // 6A shapes: LoadedHook = { slug, def }; HooksState = { lastFiredAt, cron, pending }.
  async function loadHooks(projectRoot: string): Promise<unknown[]> {
    const dir = pjoin(projectRoot, 'hooks');
    if (!existsSync(dir)) return [];
    const out: unknown[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const slug = basename(f, '.ts');
      const text = readFileSync(pjoin(dir, f), 'utf8');
      const trig = /trigger:\s*['"]([^'"]+)['"]/.exec(text);
      const every = /every:\s*['"]([^'"]+)['"]/.exec(text);
      if (trig) {
        out.push({ slug, def: { type: 'cron', trigger: trig[1], every: every?.[1], budget: { maxEpisodes: 4 } } });
      } else if (/handler/.test(text)) {
        out.push({
          slug,
          def: {
            type: 'database',
            on: { table: 'feed_items', event: 'insert' },
            budget: { maxEpisodes: 8 },
            handler: async (ctx: Record<string, unknown>) => {
              __enrichCalls.push(ctx);
              return { enriched: true };
            },
          },
        });
      }
    }
    return out;
  }

  function normalize(s: any): { lastFiredAt: Record<string, number>; cron: Record<string, { lastRunAt: number }>; pending: string[] } {
    return { lastFiredAt: s?.lastFiredAt ?? {}, cron: s?.cron ?? {}, pending: Array.isArray(s?.pending) ? s.pending : [] };
  }

  async function loadHooksState(projectRoot: string): Promise<unknown> {
    const p = pjoin(projectRoot, 'hooks-state.json');
    if (!existsSync(p)) return normalize(null);
    try {
      return normalize(JSON.parse(readFileSync(p, 'utf8')));
    } catch {
      return normalize(null);
    }
  }

  async function saveHooksState(projectRoot: string, state: unknown): Promise<void> {
    writeFileSync(pjoin(projectRoot, 'hooks-state.json'), JSON.stringify(state, null, 2));
  }

  function dueCronHooks(hooks: any[], state: any, now: number): unknown[] {
    return hooks.filter((h) => {
      if (h?.def?.type !== 'cron') return false;
      const last = state?.cron?.[h.slug]?.lastRunAt as number | undefined;
      if (last == null) return true;
      const interval = h.def.every ? parseEvery(h.def.every) : Infinity;
      return now - last >= interval;
    });
  }

  function nextCrontabLines(hooks: any[], urlTemplate: string): string[] {
    return hooks
      .filter((h) => h?.def?.type === 'cron')
      .map((h) => `* * * * * curl -fsS -X POST ${urlTemplate.replace('{slug}', h.slug)}`);
  }

  return { loadHooks, loadHooksState, saveHooksState, dueCronHooks, nextCrontabLines, parseEvery, __enrichCalls };
});

// Import AFTER the mocks so the module graph is wired to the shim.
import {
  createHookRunHandler,
  regenerateCrontab,
  bootCatchUpAndSchedule,
  runDueCronHooks,
  type HookManager,
} from './hooks.js';
// The mocked-module shared spy array (only present on the test shim).
import * as hooksMod from '../../app/hooks/index.js';
const __enrichCalls = (hooksMod as unknown as { __enrichCalls: Array<Record<string, unknown>> })
  .__enrichCalls;

// ── Fixtures ──────────────────────────────────────────────────────────────────

let root: string;
const PROJECT = 'feedapp';

async function writeProject(): Promise<void> {
  const hooksDir = join(root, PROJECT, 'hooks');
  await mkdir(hooksDir, { recursive: true });
  // A cron/declarative hook — fires every hour, delegates to an agent action.
  await writeFile(
    join(hooksDir, 'refresh-feed.ts'),
    `export default { type: 'cron', every: '1h', trigger: 'feed/curator#refresh', budget: { maxEpisodes: 4 } }`,
  );
  // An imperative database hook — has a handler.
  await writeFile(
    join(hooksDir, 'enrich.ts'),
    `export default { type: 'database', on: { table: 'items', event: 'insert' }, handler: async () => {} }`,
  );
}

async function readState(): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(join(root, PROJECT, 'hooks-state.json'), 'utf8'));
  } catch {
    return {};
  }
}

function mockManager(
  runHeadless: any = vi.fn(async () => ({ ok: true })),
): HookManager & { runHeadless: ReturnType<typeof vi.fn> } {
  return {
    runHeadless,
    getProjectDb: vi.fn(async () => ({ async: { query: () => [] } })),
  } as unknown as HookManager & { runHeadless: ReturnType<typeof vi.fn> };
}

function mockRes() {
  let status = 0;
  let body = '';
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(b?: string) {
      body = b ?? '';
      return res;
    },
  };
  return { res: res as any, get: () => ({ status, json: JSON.parse(body || '{}') }) };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env['LM_NO_CRONTAB'] = '1';
});
afterAll(async () => {
  delete process.env['LM_NO_CRONTAB'];
  if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hooks6c-'));
  await writeProject();
  __enrichCalls.length = 0;
  spawnMock.mockClear();
  spawnSyncMock.mockClear();
});

describe('boot catch-up', () => {
  it('runs an overdue cron hook exactly once, skips the database hook, and stamps state', async () => {
    const runHookFn = vi.fn(async () => {});
    const now = 1_000_000_000_000;

    await runDueCronHooks(root, [PROJECT], runHookFn, now);

    expect(runHookFn).toHaveBeenCalledTimes(1);
    expect(runHookFn).toHaveBeenCalledWith(PROJECT, 'refresh-feed'); // not the db hook
    const st = await readState();
    expect(st.lastFiredAt['refresh-feed']).toBe(now);
  });

  it('does NOT double-run on an immediate second catch-up (not yet due)', async () => {
    const runHookFn = vi.fn(async () => {});
    const now = 1_000_000_000_000;

    await runDueCronHooks(root, [PROJECT], runHookFn, now);
    expect(runHookFn).toHaveBeenCalledTimes(1);

    // 1 minute later — the 1h hook is NOT due again.
    await runDueCronHooks(root, [PROJECT], runHookFn, now + 60_000);
    expect(runHookFn).toHaveBeenCalledTimes(1);

    // …but once the hour has elapsed it fires again.
    await runDueCronHooks(root, [PROJECT], runHookFn, now + 3_600_000);
    expect(runHookFn).toHaveBeenCalledTimes(2);
  });
});

describe('in-process fallback tick', () => {
  it('runDueCronHooks (the tick body) fires a due hook', async () => {
    const runHookFn = vi.fn(async () => {});
    await runDueCronHooks(root, [PROJECT], runHookFn, Date.now());
    expect(runHookFn).toHaveBeenCalledWith(PROJECT, 'refresh-feed');
  });

  it('bootCatchUpAndSchedule wires a 60s tick when crontab is unavailable, and it drives due hooks', async () => {
    vi.useFakeTimers();
    try {
      // Use a 30s-every hook so the tick re-fires deterministically.
      await writeFile(
        join(root, PROJECT, 'hooks', 'refresh-feed.ts'),
        `export default { type: 'cron', every: '30s', trigger: 'feed/curator#refresh' }`,
      );
      const runHookFn = vi.fn(async () => {});
      const { tick } = await bootCatchUpAndSchedule(
        mockManager(),
        root,
        [PROJECT],
        8080,
        runHookFn,
        { intervalMs: 30_000 },
      );
      expect(tick).toBeDefined(); // LM_NO_CRONTAB=1 ⇒ fallback tick started
      expect(runHookFn).toHaveBeenCalledTimes(1); // boot catch-up fired it once

      await vi.advanceTimersByTimeAsync(30_000); // 30s later → due again
      expect(runHookFn).toHaveBeenCalledTimes(2);

      if (tick) clearInterval(tick);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('regenerateCrontab guard', () => {
  it('no-ops (no spawn) under LM_NO_CRONTAB=1', async () => {
    await regenerateCrontab(root, [PROJECT], 8080);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

describe('hook run endpoint', () => {
  it('404s an unknown slug without invoking the agent runner', async () => {
    const manager = mockManager();
    const handler = createHookRunHandler(manager, root);
    const { res, get } = mockRes();

    await handler({} as any, res, { projectId: PROJECT, slug: 'does-not-exist' });

    expect(get().status).toBe(404);
    expect(manager.runHeadless).not.toHaveBeenCalled();
  });

  it('invokes runHeadless for a declarative cron hook and stamps state', async () => {
    const manager = mockManager();
    const handler = createHookRunHandler(manager, root);
    const { res, get } = mockRes();

    await handler({} as any, res, { projectId: PROJECT, slug: 'refresh-feed' });

    expect(manager.runHeadless).toHaveBeenCalledTimes(1);
    const arg = manager.runHeadless.mock.calls[0]![0];
    expect(arg).toMatchObject({
      projectId: PROJECT,
      spaceRef: 'feed/curator',
      agentSlug: 'curator',
    });
    expect(String(arg.message)).toContain('refresh');
    expect(get().status).toBe(200);
    expect(get().json).toMatchObject({ ok: true });
    const st = await readState();
    expect(st.cron['refresh-feed'].lastRunAt).toBeTypeOf('number');
  });

  it('invokes an imperative handler hook with a { db, delegate } ctx', async () => {
    const manager = mockManager();
    const handler = createHookRunHandler(manager, root);
    const { res, get } = mockRes();

    await handler({} as any, res, { projectId: PROJECT, slug: 'enrich' });

    expect(get().status).toBe(200);
    expect(__enrichCalls).toHaveLength(1);
    expect(__enrichCalls[0]!['db']).toBeDefined();
    expect(typeof __enrichCalls[0]!['delegate']).toBe('function');
  });

  it('enqueues (queued:true) when the run is budget-exhausted', async () => {
    const manager = mockManager(vi.fn(async () => ({ status: 'budget-exhausted' })));
    const handler = createHookRunHandler(manager, root);
    const { res, get } = mockRes();

    await handler({} as any, res, { projectId: PROJECT, slug: 'refresh-feed' });

    expect(get().status).toBe(200);
    expect(get().json).toMatchObject({ queued: true });
    const st = await readState();
    expect(st.pending).toContain('refresh-feed');
    expect(st.cron['refresh-feed']?.lastRunAt).toBeUndefined(); // it did NOT run
  });
});
