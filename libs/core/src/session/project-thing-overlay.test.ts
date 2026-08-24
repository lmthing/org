import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from './session.js';
import { createMockStreamFn } from '../testing/mock-provider.js';

/**
 * Per-project THING overlay (`projectThingDir`): a project's OWN copy of `user-thing` becomes the
 * RUNNING THING, shadowing the shipped system THING — its instruct body AND a project-only
 * knowledge domain both win. A missing/empty copy falls back to the shipped THING.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** A minimal system-spaces dir containing one `user-thing` space with the given instruct body. */
async function makeSystemThing(body: string): Promise<string> {
  const sysRoot = await tmp('lmthing-sys-');
  const instruct = join(sysRoot, 'user-thing', 'agents', 'thing', 'instruct.md');
  await mkdir(dirname(instruct), { recursive: true });
  await writeFile(instruct, `---\ntitle: THING\n---\n\n${body}\n`, 'utf8');
  return join(sysRoot, 'user-thing');
}

/** A project copy of `user-thing` with its own instruct body and an optional `self/*` knowledge. */
async function makeProjectThing(body: string, knowledge?: { field: string; aspect: string; text: string }): Promise<string> {
  const dir = await tmp('lmthing-projthing-');
  const instruct = join(dir, 'agents', 'thing', 'instruct.md');
  await mkdir(dirname(instruct), { recursive: true });
  await writeFile(instruct, `---\ntitle: THING\n---\n\n${body}\n`, 'utf8');
  if (knowledge) {
    const k = join(dir, 'knowledge', 'self', knowledge.field, `${knowledge.aspect}.md`);
    await mkdir(dirname(k), { recursive: true });
    await writeFile(k, `# ${knowledge.aspect}\n\n${knowledge.text}\n`, 'utf8');
  }
  return dir;
}

function makeSession(opts: { spaceDir: string; systemThing: string; projectThingDir?: string }): Session {
  return new Session(
    {
      spaceDir: opts.spaceDir,
      agentSlug: 'thing',
      modelAlias: 'mock',
      renderHost: { display: () => {}, ask: async () => undefined, log: () => {} },
      systemSpaceDirs: [opts.systemThing],
      projectThingDir: opts.projectThingDir,
    },
    { streamFn: createMockStreamFn(() => 'display("noop");') },
  );
}

describe('per-project THING overlay', () => {
  it('runs the PROJECT copy of THING, shadowing the shipped one', async () => {
    const projectRoot = await tmp('lmthing-proj-'); // no agents/ of its own
    const systemThing = await makeSystemThing('SYSTEM THING BODY');
    const projectThingDir = await makeProjectThing('PROJECT THING BODY');

    const session = makeSession({ spaceDir: projectRoot, systemThing, projectThingDir });
    const { agentSlug, systemBlock } = await session.buildSystemPrompt();
    session.dispose();

    expect(agentSlug).toBe('thing');
    expect(systemBlock).toContain('PROJECT THING BODY');
    expect(systemBlock).not.toContain('SYSTEM THING BODY');
  }, 30_000);

  it('falls back to the shipped THING when the project has no copy', async () => {
    const projectRoot = await tmp('lmthing-proj-');
    const systemThing = await makeSystemThing('SYSTEM THING BODY');

    const session = makeSession({ spaceDir: projectRoot, systemThing }); // no projectThingDir
    const { systemBlock } = await session.buildSystemPrompt();
    session.dispose();

    expect(systemBlock).toContain('SYSTEM THING BODY');
  }, 30_000);

  it('does not let an EMPTY placeholder project THING shadow the shipped one', async () => {
    const projectRoot = await tmp('lmthing-proj-');
    const systemThing = await makeSystemThing('SYSTEM THING BODY');
    // A project copy whose thing has no instruct body and no actions.
    const emptyDir = await tmp('lmthing-projthing-empty-');
    const instruct = join(emptyDir, 'agents', 'thing', 'instruct.md');
    await mkdir(dirname(instruct), { recursive: true });
    await writeFile(instruct, `---\ntitle: THING\n---\n`, 'utf8'); // empty body

    const session = makeSession({ spaceDir: projectRoot, systemThing, projectThingDir: emptyDir });
    const { systemBlock } = await session.buildSystemPrompt();
    session.dispose();

    expect(systemBlock).toContain('SYSTEM THING BODY');
  }, 30_000);

  it('survives an unloadable project THING (falls back, never throws)', async () => {
    const projectRoot = await tmp('lmthing-proj-');
    const systemThing = await makeSystemThing('SYSTEM THING BODY');
    // A dir with no agents/ — loadSpace() throws; the overlay must swallow it.
    const brokenDir = await tmp('lmthing-projthing-broken-');

    const session = makeSession({ spaceDir: projectRoot, systemThing, projectThingDir: brokenDir });
    const { systemBlock } = await session.buildSystemPrompt();
    session.dispose();

    expect(systemBlock).toContain('SYSTEM THING BODY');
  }, 30_000);
});
