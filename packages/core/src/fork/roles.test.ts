import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForkEngine } from './fork.js';
import { normalizeRole, rolePreamble, roleProfile } from './roles.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession } from '../eval/stream-types.js';

const silentHost: RenderHost = {
  display: () => {},
  ask: () => Promise.resolve(''),
  log: () => {},
};

function makeEngine(streamText: string): ForkEngine {
  let aborted = false;
  async function* gen() {
    if (!aborted) yield streamText;
  }
  return new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: '/tmp',
    parentAgentSlug: 'test',
    renderHost: silentHost,
    streamFn: async () => ({ textStream: gen(), abort() { aborted = true; } } as StreamSession),
  });
}

describe('fork roles', () => {
  it('normalizeRole defaults unknown/undefined to general', () => {
    expect(normalizeRole(undefined)).toBe('general');
    expect(normalizeRole('weird')).toBe('general');
    expect(normalizeRole('explore')).toBe('explore');
    expect(normalizeRole('plan')).toBe('plan');
  });

  it('roleProfile withholds write for explore/plan, allows for general', () => {
    expect(roleProfile('explore').allowWrite).toBe(false);
    expect(roleProfile('plan').allowWrite).toBe(false);
    expect(roleProfile('general').allowWrite).toBe(true);
    expect(roleProfile(undefined).allowWrite).toBe(true);
  });

  it('preambles carry the context-firewall instruction', () => {
    for (const role of ['explore', 'plan', 'general']) {
      expect(rolePreamble(role)).toContain('currentTask.resolve()');
    }
    expect(rolePreamble('explore')).toMatch(/read-only/i);
  });

  it('an explore fork CANNOT write (capability withheld at injection)', async () => {
    const target = join(tmpdir(), 'lmthing_explore_should_not_write.txt');
    rmSync(target, { force: true });
    const engine = makeEngine(
      `const w = writeFileRaw(${JSON.stringify(target)}, "data");\ncurrentTask.resolve({ wrote: w.ok, err: w.error || "" });\n`,
    );
    const result = await engine.fork<{ wrote: boolean; err: string }>({
      instruction: 'try to write',
      output: { wrote: 'boolean', err: 'string' },
      role: 'explore',
    });
    expect(result.wrote).toBe(false);
    expect(result.err).toMatch(/read-only/);
    expect(existsSync(target)).toBe(false);
  });

  it('a general fork CAN write', async () => {
    const target = join(tmpdir(), 'lmthing_general_can_write.txt');
    rmSync(target, { force: true });
    const engine = makeEngine(
      `const w = writeFileRaw(${JSON.stringify(target)}, "data");\ncurrentTask.resolve({ wrote: w.ok });\n`,
    );
    const result = await engine.fork<{ wrote: boolean }>({
      instruction: 'write a file',
      output: { wrote: 'boolean' },
      role: 'general',
    });
    expect(result.wrote).toBe(true);
    expect(existsSync(target)).toBe(true);
    rmSync(target, { force: true });
  });
});
