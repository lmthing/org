import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from './session.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * E7 live finding: an agent built and registered in one session was INVISIBLE to
 * the next session in the same project. Two guarantees locked here:
 *  1. preloadSpaceDirs spaces are advertised in the system prompt ("Project agents"),
 *  2. delegating to a preloaded space works end-to-end in a fresh session.
 */

const tmpDirs: string[] = [];
afterAll(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

const lastUser = (o: StreamOpts): string =>
  [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

async function makeMainSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-preload-main-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `---\ntitle: Main\ncanDelegateTo:\n  - "registered:*"\n---\n\nTest agent.\n`, 'utf8');
  return dir;
}

async function makeBuiltSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-preload-built-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'tracker', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: Reading List Tracker\nactions:\n  - id: add\n    label: Add\n    description: Add a book\n---\n\nTracker.\n`,
    'utf8',
  );
  return dir;
}

describe('preloaded project spaces (E7 live finding)', () => {
  it('are advertised in the system prompt and delegatable in a fresh session', async () => {
    const mainDir = await makeMainSpace();
    const builtDir = await makeBuiltSpace();

    const systems: string[] = [];
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      systems.push(o.system ?? '');
      const last = lastUser(o);
      if (last.includes('Run action: add')) return `currentTask.resolve({ added: true });`;
      if (last.includes('added')) return `display("added=" + (r as any).added);`;
      return `const r = await delegate(${JSON.stringify(builtDir)}, 'tracker', 'add', { query: 'book' });`;
    });

    const displays: unknown[] = [];
    const session = new Session(
      {
        spaceDir: mainDir,
        agentSlug: 'main',
        modelAlias: 'mock',
        renderHost: { display: (d) => { displays.push(d); }, ask: async () => undefined, log: () => {} },
        systemSpaceDirs: [],
        preloadSpaceDirs: [builtDir],
      },
      { streamFn },
    );
    let error: Error | undefined;
    try {
      await session.start('add a book');
    } catch (e) {
      error = e as Error;
    }
    session.dispose();

    expect(error).toBeUndefined();
    // 1. Advertised: the root session prompt names the built agent + coordinates.
    expect(systems[0]).toContain('# Project agents (already built & registered)');
    expect(systems[0]).toContain('Reading List Tracker');
    expect(systems[0]).toContain(JSON.stringify(builtDir));
    expect(systems[0]).toContain('actions: add');
    // 2. Delegatable via registered:* in a fresh session.
    expect(displays).toContain('added=true');
  }, 30_000);
});
