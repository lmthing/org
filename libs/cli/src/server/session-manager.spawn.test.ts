/**
 * SessionManager api-runtime wiring (the two platform gaps fixed):
 *   (a) `spawn(ref, input)` from an app-API handler now runs a REAL fire-and-forget
 *       headless agent via runHeadless (was a no-op stub) — with the `space/agent#action`
 *       ref parsed into { projectId, spaceRef, agentSlug } + the action/input in the message.
 *   (b) a project with an `api/` dir exposes an agent-facing `apiCall` in its app globals
 *       (was never injected), so a project-app agent session can call its own endpoints.
 *
 * Keyless: buildSession/runHeadless are stubbed; getProjectContracts is overridden to
 * skip the heavy ts-json-schema generation.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const RUNS_SCHEMA = JSON.stringify({
  title: 'Runs',
  description: 'Pending spawn runs.',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
    status: { type: 'string', description: 'run status', default: 'pending' },
  },
});

const KICK_HANDLER = `
export const name = 'kick'
export const description = 'Insert a pending run and spawn the scheduler.'
export default async function handler(input, ctx) {
  const inserted = await ctx.db.insert('runs', [{ status: 'pending' }])
  const row = inserted[0]
  const { runId } = await ctx.spawn('planner/scheduler#lay-out', { rowId: row.id })
  return { runId, rowId: row.id }
}
`;

/** A tmp lmthingRoot with a 'user' project that has a database/ table + an api/ endpoint. */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-spawn-'));
  tmpDirs.push(root);
  const proj = join(root, 'user');
  await mkdir(join(proj, 'database'), { recursive: true });
  await writeFile(join(proj, 'database', 'runs.json'), RUNS_SCHEMA, 'utf8');
  const handler = join(proj, 'api', 'kick', 'POST.ts');
  await mkdir(dirname(handler), { recursive: true });
  await writeFile(handler, KICK_HANDLER, 'utf8');
  return root;
}

describe('SessionManager api-runtime wiring', () => {
  it('(a) spawn() from an api handler runs runHeadless with the parsed ref + action', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({ streamFn: (async function* () {})() as never, lmthingRoot: root });
    // Skip heavy contract generation; capture the headless run instead of executing it.
    (manager as unknown as { getProjectContracts: () => Promise<null> }).getProjectContracts = async () => null;
    const runs: Array<{ projectId?: string; spaceRef?: string; agentSlug: string; message: string }> = [];
    manager.runHeadless = (async (opts: {
      projectId?: string;
      spaceRef?: string;
      agentSlug: string;
      message: string;
    }) => {
      runs.push(opts);
      return { ok: true, result: 'ok', sessionId: 's1' };
    }) as typeof manager.runHeadless;

    const rt = await manager.getApiRuntime(root, 'user');
    expect(rt).not.toBeNull();
    const res = await rt!.handle('POST', '/kick', {});
    expect(res.status).toBe(200);
    expect((res.body as { runId: string }).runId).toBeTruthy();

    // spawn is fire-and-forget (synchronously kicked off during proxy servicing).
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toHaveLength(1);
    expect(runs[0].projectId).toBe('user');
    expect(runs[0].spaceRef).toBe('planner/scheduler');
    expect(runs[0].agentSlug).toBe('scheduler');
    expect(runs[0].message).toContain('lay-out');
    manager.closeProjectDbs();
  });

  it('(b) a project with an api/ dir exposes apiCall in the agent session app globals', async () => {
    const root = await makeRoot();
    let capturedAppGlobals: BuildSessionArgs['appGlobals'];
    const manager = new SessionManager({
      streamFn: (async function* () {})() as never,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) => {
        capturedAppGlobals = args.appGlobals;
        // Minimal fake session: start() is a no-op, dispose() is a no-op.
        return { start: async () => {}, dispose: () => {} } as never;
      },
    });
    (manager as unknown as { getProjectContracts: () => Promise<null> }).getProjectContracts = async () => null;

    const res = await manager.runHeadless({ projectId: 'user', agentSlug: 'thing', message: 'hi' });
    expect(res.ok).toBe(true);
    expect(capturedAppGlobals).toBeTruthy();
    expect(typeof capturedAppGlobals!.apiCall).toBe('function');
    manager.closeProjectDbs();
  });
});
