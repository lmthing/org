import { describe, it, expect } from 'vitest';
import { DelegateRegistry } from './registry.js';
import type { Space } from '../spaces/load.js';

/** Minimal Space stub with the fields the registry reads. */
function fakeSpace(dir: string, packageName: string | undefined, agentSlugs: string[]): Space {
  const agents: Record<string, unknown> = {};
  for (const s of agentSlugs) agents[s] = { slug: s };
  return { dir, packageName, agents } as unknown as Space;
}

describe('DelegateRegistry.resolve — actionable errors', () => {
  const reg = new DelegateRegistry(
    new Map<string, Space>([
      ['/sys/deep_research', fakeSpace('/sys/deep_research', 'deep-research-space', ['researcher'])],
      ['/sys/engineer', fakeSpace('/sys/engineer', 'engineer-space', ['engineer'])],
    ]),
  );

  it('resolves a correct package/agent target', () => {
    const { agent } = reg.resolve('deep-research-space/researcher');
    expect((agent as { slug: string }).slug).toBe('researcher');
  });

  it('lists the real space keys and agents when the space key is wrong (hallucinated title)', () => {
    // The architect hallucinated "deep-research-analyst" (the agent TITLE) as the key.
    expect(() => reg.resolve('deep-research-analyst/research')).toThrow(/no space matched "deep-research-analyst"/);
    try {
      reg.resolve('deep-research-analyst/research');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('deep-research-space');
      expect(msg).toContain('researcher');
      expect(msg).toContain('engineer-space');
    }
  });

  it('names available agents when the space matches but the agent slug is wrong', () => {
    expect(() => reg.resolve('deep-research-space/analyst')).toThrow(/has no agent "analyst".*available agents: researcher/);
  });
});
