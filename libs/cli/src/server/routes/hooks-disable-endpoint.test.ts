/**
 * The settings hooks endpoints — `GET /api/hooks` (list, grouped client-side) and
 * `POST /api/projects/:projectId/hooks/:slug/disabled` (toggle the state overlay).
 * Uses the REAL hooks loader against a tmp project (cron + event + webhook files).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createHooksListHandler, createHookDisableHandler, type HookSummary, type HookManager } from './hooks.js';

let root: string;
const PROJECT = 'proj';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hooks-ep-'));
  const proot = join(root, PROJECT);
  await mkdir(join(proot, 'hooks'), { recursive: true });
  await writeFile(join(proot, 'project.json'), JSON.stringify({ id: PROJECT, name: 'Proj', createdAt: 0 }));
  await writeFile(join(proot, 'hooks', 'nightly.ts'), `export default { type: 'cron', daily: '02:00', trigger: 'sp/agent#go' }`);
  await writeFile(join(proot, 'hooks', 'on-insert.ts'), `export default { type: 'event', on: { event: 'project/db.items.insert' }, trigger: 'sp/agent#go' }`);
  await writeFile(join(proot, 'hooks', 'inbox.ts'), `export default { type: 'webhook', path: 'inbox', trigger: 'sp/agent#go' }`);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** A capturing fake ServerResponse. */
function fakeRes() {
  const out = { status: 0, body: undefined as unknown };
  const res = {
    writeHead(status: number) { out.status = status; return res; },
    end(str?: string) { out.body = str ? JSON.parse(str) : undefined; },
  } as unknown as ServerResponse;
  return { res, out };
}

const req = (body?: unknown): IncomingMessage =>
  Readable.from([Buffer.from(body === undefined ? '' : JSON.stringify(body))]) as unknown as IncomingMessage;

async function list(): Promise<HookSummary[]> {
  const { res, out } = fakeRes();
  await createHooksListHandler(root)(req(), res, {});
  return (out.body as { hooks: HookSummary[] }).hooks;
}

const fakeManager = { republish: async () => {} } as unknown as HookManager;

describe('GET /api/hooks + toggle', () => {
  it('lists all three hook types across the project, enabled by default', async () => {
    const hooks = await list();
    const byType = Object.fromEntries(hooks.map((h) => [h.type, h]));
    expect(Object.keys(byType).sort()).toEqual(['cron', 'event', 'webhook']);
    expect(byType.cron!.daily).toBe('02:00');
    expect(byType.event!.on).toBe('project/db.items.insert');
    expect(byType.webhook!.path).toBe('inbox');
    expect(hooks.every((h) => h.disabled === false)).toBe(true);
    expect(hooks.every((h) => h.projectId === PROJECT)).toBe(true);
  });

  it('disable then re-enable round-trips through the state overlay', async () => {
    const { res: r1, out: o1 } = fakeRes();
    await createHookDisableHandler(fakeManager, root)(req({ disabled: true }), r1, { projectId: PROJECT, slug: 'nightly' });
    expect(o1.status).toBe(200);

    let hooks = await list();
    expect(hooks.find((h) => h.slug === 'nightly')!.disabled).toBe(true);
    // The others stay enabled.
    expect(hooks.find((h) => h.slug === 'inbox')!.disabled).toBe(false);

    const { res: r2 } = fakeRes();
    await createHookDisableHandler(fakeManager, root)(req({ disabled: false }), r2, { projectId: PROJECT, slug: 'nightly' });
    hooks = await list();
    expect(hooks.find((h) => h.slug === 'nightly')!.disabled).toBe(false);
  });
});
