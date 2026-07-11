/**
 * SessionManager folds a project's `functions/*.ts` (the third function scope)
 * into the session it builds for a project-rooted run. Keyless — uses the mock
 * provider and a spy `buildSession` to capture the BuildSessionArgs the manager
 * assembles, proving:
 *   (a) a project with `<projectRoot>/functions/greet.ts` yields args carrying
 *       that function's source in `projectFunctions`;
 *   (b) a project with no functions/ dir yields an empty (but present) map;
 *   (c) the loaded set is cached + invalidatable.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session, createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** A tmp lmthingRoot with a minimal one-agent 'user' project. `extra` seeds
 *  additional files (e.g. `functions/greet.ts`) under the project root. */
async function makeRoot(extra: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-projfns-mgr-'));
  tmpDirs.push(root);
  const files: Record<string, string> = {
    'user/agents/thing/instruct.md': 'You are a test agent.\n',
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [join('user', k), v])),
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return root;
}

const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
  const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
  return hasAssistant ? '' : `display("done");`;
});

/** Build a manager whose buildSession records the last args it received. */
function makeManager(root: string): { manager: SessionManager; lastArgs: () => BuildSessionArgs | undefined } {
  let captured: BuildSessionArgs | undefined;
  const manager = new SessionManager({
    streamFn: mockStreamFn,
    lmthingRoot: root,
    buildSession: (args: BuildSessionArgs) => {
      captured = args;
      return new Session(
        {
          spaceDir: args.spaceDir,
          agentSlug: args.agentSlug,
          modelAlias: 'mock',
          renderHost: args.renderHost,
          systemSpaceDirs: [], // keyless
          budget: args.budget,
          projectFunctions: args.projectFunctions,
          projectFunctionsBundled: args.projectFunctionsBundled,
        },
        { streamFn: mockStreamFn },
      );
    },
  });
  return { manager, lastArgs: () => captured };
}

describe('SessionManager project functions wiring', () => {
  it('(a) folds <projectRoot>/functions/*.ts into projectFunctions', async () => {
    const root = await makeRoot({
      'functions/greet.ts': '/** Greet */\nexport function greet(): string { return "hi"; }',
    });
    const { manager, lastArgs } = makeManager(root);
    const res = await manager.runHeadless({ agentSlug: 'thing', message: 'hello' });
    expect(res.ok).toBe(true);
    const args = lastArgs();
    expect(args?.projectFunctions).toBeDefined();
    expect(args?.projectFunctions?.['greet']).toContain('export function greet');
  });

  it('(b) yields an empty (present) map for a project with no functions/', async () => {
    const root = await makeRoot();
    const { manager, lastArgs } = makeManager(root);
    await manager.runHeadless({ agentSlug: 'thing', message: 'hello' });
    expect(lastArgs()?.projectFunctions).toEqual({});
  });

  it('(c) caches the loaded set and reloads after invalidation', async () => {
    const root = await makeRoot();
    const { manager } = makeManager(root);
    const projectRoot = join(root, 'user');

    const first = await manager.getProjectFunctions(projectRoot);
    expect(first.functions).toEqual({});

    // Write a function AFTER the first (cached) load — the cache still shows empty.
    const fnPath = join(projectRoot, 'functions', 'later.ts');
    await mkdir(dirname(fnPath), { recursive: true });
    await writeFile(fnPath, 'export function later(): number { return 1; }', 'utf8');
    expect((await manager.getProjectFunctions(projectRoot)).functions).toEqual({});

    // Invalidate → the next load picks up the new function.
    manager.invalidateProjectFunctions(projectRoot);
    expect(Object.keys((await manager.getProjectFunctions(projectRoot)).functions)).toEqual(['later']);
  });
});
