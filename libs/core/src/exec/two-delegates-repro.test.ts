import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from '../session/session.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * REPRO (E2 live finding): the SECOND sequential `await delegate(...)` in a
 * session evaluated without registering a yield — the statement entered the
 * typecheck context but the binding stayed undefined in the VM.
 */

const tmpDirs: string[] = [];
afterAll(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

const lastUser = (o: StreamOpts): string =>
  [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

async function makeSessionSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-tworepro-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `---\ntitle: Main\n---\n\nTest agent.\n`, 'utf8');
  return dir;
}

async function makeWorkerSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-tworepro-worker-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'worker', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: Worker\nactions:\n  - id: compute\n    label: Compute\n    description: Compute\n---\n\nWorker.\n`,
    'utf8',
  );
  return dir;
}

describe('two sequential session delegates', () => {
  it('the second await delegate(...) yields and binds (not silently skipped)', async () => {
    const workerDir = await makeWorkerSpace();
    const spaceDir = await makeSessionSpace();
    const turns: string[] = [];
    let childCalls = 0;
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const last = lastUser(o);
      turns.push(last);
      if (last.includes('Run action: compute')) {
        childCalls++;
        return `currentTask.resolve({ v: ${childCalls} });`;
      }
      // second resume: b bound
      if (last.includes('b:')) return `display("second=" + (b as any).v);`;
      // first resume: a bound → issue the SECOND delegate, shaped like the live
      // E2 statement: multiline args object + multiline `as {...}` cast.
      if (last.includes('a:')) {
        return `const b = await delegate(${JSON.stringify(workerDir)}, 'worker', 'compute', {
  query: "two"
}) as {
  v: number;
};`;
      }
      return `const a = await delegate(${JSON.stringify(workerDir)}, 'worker', 'compute', { query: 'one' });`;
    });

    const displays: unknown[] = [];
    const session = new Session(
      {
        spaceDir,
        agentSlug: 'main',
        modelAlias: 'mock',
        renderHost: { display: (d) => { displays.push(d); }, ask: async () => undefined, log: () => {} },
        systemSpaceDirs: [],
      },
      { streamFn },
    );
    let error: Error | undefined;
    try {
      await session.start('go');
    } catch (e) {
      error = e as Error;
    }
    session.dispose();

    expect(error).toBeUndefined();
    expect(childCalls).toBe(2);
    expect(displays).toContain('second=2');
  }, 30_000);
});
