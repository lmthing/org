/**
 * Plan S9 — headless SPACE-tasklist runner (`SessionManager.runTasklistHeadless`).
 *
 * Keyless (mock provider). A fixture project installs a space whose tasklist mixes
 * an AGENT node and a `kind:'code'` node. Proves end-to-end:
 *   (a) the run resolves the installed space's tasklist, the agent node's output
 *       feeds the code node (upstream threading), and the returned TaskEnvelope
 *       carries the code node's result;
 *   (b) a code node's `callConnection` is gated — a provider the tasklist did not
 *       declare (∩ the space's own providers) throws, failing the required task;
 *   (c) the run is RECORDED as a headless session under the space's sessions dir
 *       (inspectable in chat) and never enters the interactive pool.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager } from './session-manager.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** A tmp lmthingRoot with a `user` project that has an installed `greeter` space.
 *  `greeter/tasklists/flow` = agent node (`list`) → code node (`sum`).
 *  `greeter/tasklists/reach` = a lone code node that calls `callConnection`. */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-tlrunner-'));
  tmpDirs.push(root);

  const spaceDir = join(root, 'user', 'spaces', 'greeter');
  // Own provider = "demo" (so an undeclared "slack" call is denied by the gate).
  await mkdir(spaceDir, { recursive: true });
  await writeFile(
    join(spaceDir, 'package.json'),
    JSON.stringify({ name: 'greeter', lmthing: { connection: { provider: 'demo' } } }),
    'utf8',
  );
  await mkdir(join(spaceDir, 'agents', 'main'), { recursive: true });
  await writeFile(join(spaceDir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');

  // flow: agent node → code node.
  const flow = join(spaceDir, 'tasklists', 'flow');
  await mkdir(flow, { recursive: true });
  await writeFile(join(flow, 'index.md'), 'Flow.\n', 'utf8');
  await writeFile(
    join(flow, '01-list.md'),
    `---\nid: list\noutput:\n  items: array\n---\n\nLIST_TOKEN: produce the list.`,
    'utf8',
  );
  await writeFile(
    join(flow, '02-sum.ts'),
    `export const node = { dependsOn: ['list'], output: { total: 'number' }, goal: true };\n` +
      `export async function run(ctx, inputs) {\n` +
      `  const items = (inputs && inputs.list && inputs.list.items) || [];\n` +
      `  return { total: items.reduce((a, b) => a + b, 0) };\n` +
      `}\n`,
    'utf8',
  );

  // reach: a code node that reaches for an UNDECLARED provider (the tasklist
  // declares no connections, so the gate denies every callConnection).
  const reach = join(spaceDir, 'tasklists', 'reach');
  await mkdir(reach, { recursive: true });
  await writeFile(join(reach, 'index.md'), 'Reach.\n', 'utf8');
  await writeFile(
    join(reach, '01-post.ts'),
    `export const node = { output: { ok: 'boolean' }, goal: true };\n` +
      `export async function run(ctx) {\n` +
      `  await ctx.callConnection('slack', { method: 'POST', path: '/x' });\n` +
      `  return { ok: true };\n` +
      `}\n`,
    'utf8',
  );

  // write: a code node that AUTHORS a live-project table via the ctx writer proxy
  // (proves createProjectAuthoringGlobals reaches a worker code node's ctx).
  const write = join(spaceDir, 'tasklists', 'write');
  await mkdir(write, { recursive: true });
  await writeFile(join(write, 'index.md'), 'Write.\n', 'utf8');
  await writeFile(
    join(write, '01-author.ts'),
    `export const node = { output: { ok: 'boolean' }, goal: true };\n` +
      `export async function run(ctx) {\n` +
      `  const w = await ctx.writeProjectTable('widgets', { title: 'Widgets', description: 'A widget table.', columns: { id: { type: 'string', description: 'primary key', primaryKey: true, generated: 'uuid' } } }, [{ id: 'w1' }]);\n` +
      `  return { ok: w.ok };\n` +
      `}\n`,
    'utf8',
  );

  return root;
}

/** Mock: answer the agent `list` node (matched by its instruction token). */
const mockStreamFn = createMockStreamFn((o: StreamOpts) => {
  const user = o.messages.map((m) => m.content).join('\n');
  if (user.includes('LIST_TOKEN')) return `currentTask.resolve({ items: [1, 2, 3, 4] });`;
  return '';
});

describe('SessionManager.runTasklistHeadless (S9, keyless)', () => {
  it('(a) runs a mixed agent+code tasklist; code node gets upstream output', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({ streamFn: mockStreamFn, lmthingRoot: root });

    const envelope = await manager.runTasklistHeadless({
      projectId: 'user',
      spaceId: 'greeter',
      slug: 'flow',
    });

    // The code node summed the agent node's [1,2,3,4].
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ total: 10 });
    // Never entered the interactive pool.
    expect(manager.listSessions().length).toBe(0);
  });

  it('(b) records the run as an inspectable headless session', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({ streamFn: mockStreamFn, lmthingRoot: root });

    await manager.runTasklistHeadless({ projectId: 'user', spaceId: 'greeter', slug: 'flow' });

    const sessions = await manager.listSpaceSessions('user', 'greeter');
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.title).toBe('Tasklist greeter/flow');
    expect(sessions[0]!.spaceId).toBe('greeter');
  });

  it('(c) gates a code node callConnection to an undeclared provider', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({ streamFn: mockStreamFn, lmthingRoot: root });

    await expect(
      manager.runTasklistHeadless({ projectId: 'user', spaceId: 'greeter', slug: 'reach' }),
    ).rejects.toThrow(/callConnection\("slack"\)|not allowed/);

    // The failed run is still recorded (status: error), so it's inspectable.
    const sessions = await manager.listSpaceSessions('user', 'greeter');
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.status).toBe('error');
  });

  it('(e) a code node authors a live-project table via ctx.writeProjectTable', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({ streamFn: mockStreamFn, lmthingRoot: root });

    const envelope = await manager.runTasklistHeadless({ projectId: 'user', spaceId: 'greeter', slug: 'write' });

    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ ok: true });
    // The writer proxy reached the main-process authoring globals and the table file landed.
    const raw = await readFile(join(root, 'user', 'database', 'widgets.json'), 'utf8');
    expect(JSON.parse(raw).title).toBe('Widgets');
  });

  it('(d) throws on an unknown tasklist slug', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({ streamFn: mockStreamFn, lmthingRoot: root });
    await expect(
      manager.runTasklistHeadless({ projectId: 'user', spaceId: 'greeter', slug: 'nope' }),
    ).rejects.toThrow(/not found/);
  });
});
