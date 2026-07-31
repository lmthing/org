import { describe, it, expect } from 'vitest';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpace, type Space } from './load.js';
import { SYSTEM_SPACE_NAMES } from './system.js';
import { parseDelegateRef } from '../delegate/ref.js';

const SYS = resolve(dirname(fileURLToPath(import.meta.url)), '../../system-spaces');

/**
 * `loadSpace` validates every `functions:`, `components:`, `knowledge:` and `actions[].tasklist`
 * reference against the space's own siblings and throws on a miss — but `canDelegateTo` points
 * ACROSS spaces, so nothing in the loader can check it. A typo there costs nothing at load time,
 * passes every existing gate, and only surfaces when a person asks for the one thing that needed
 * the delegation — at which point the agent improvises instead of handing the work over.
 *
 * This is the write-time gate for that: resolve each ref the way the runtime does — space key is
 * the space DIRECTORY BASENAME, agent is the slug — and fail the build if it names nothing.
 */
async function loadAll(): Promise<Map<string, Space>> {
  const spaces = new Map<string, Space>();
  for (const name of SYSTEM_SPACE_NAMES) {
    const dir = resolve(SYS, name);
    // requireAgents:false — function-only system spaces (system-global) ship no agents/.
    spaces.set(basename(dir), await loadSpace(dir, { requireAgents: false }));
  }
  return spaces;
}

describe('shipped system spaces — canDelegateTo refs resolve', () => {
  it('every SYSTEM_SPACE_NAMES entry exists on disk and loads', async () => {
    // Guards the other half of the same gap: a name in the registry with no directory is skipped
    // silently by `loadSystemSpaces` (it swallows the throw), so the space is simply absent.
    await expect(loadAll()).resolves.toBeInstanceOf(Map);
  });

  it('names a real space and a real agent for every cross-space ref', async () => {
    const spaces = await loadAll();
    const unresolved: string[] = [];

    for (const [spaceKey, space] of spaces) {
      for (const agent of Object.values(space.agents)) {
        for (const ref of agent.canDelegateTo ?? []) {
          // Wildcards are policy, not targets: "*" is unrestricted and "registered:*" defers to
          // whatever the session registered at runtime. Neither names a shipped agent.
          if (ref === '*' || ref.startsWith('registered:')) continue;
          const parsed = parseDelegateRef(ref);
          if (parsed.scope === 'npm') continue; // resolved from node_modules, not from this tree

          const targetSpace = parsed.scope === 'self' ? space : spaces.get(parsed.space!);
          const where = `${spaceKey}/${agent.slug} → "${ref}"`;
          if (!targetSpace) { unresolved.push(`${where}: no system space "${parsed.space}"`); continue; }
          if (!(parsed.agent in targetSpace.agents)) {
            unresolved.push(`${where}: space "${parsed.space ?? spaceKey}" has no agent "${parsed.agent}" (has: ${Object.keys(targetSpace.agents).join(', ') || 'none'})`);
          }
        }
      }
    }

    expect(unresolved, 'these canDelegateTo refs name nothing — the delegation silently never happens').toEqual([]);
  });

  /**
   * The escalation chain the zerostack integration exists to provide. Each link is asserted
   * separately from the generic check above, because a REMOVED link also resolves cleanly — the
   * generic test only catches a ref that is wrong, not one that is missing.
   */
  it('routes hard engineering work THING/architect/automator → engineer → zerostack', async () => {
    const spaces = await loadAll();
    const delegatesTo = (spaceKey: string, slug: string) =>
      spaces.get(spaceKey)?.agents[slug]?.canDelegateTo ?? [];

    expect(delegatesTo('user-thing', 'thing')).toContain('system-engineer/engineer');
    expect(delegatesTo('system-architect', 'architect')).toContain('system-engineer/engineer');
    expect(delegatesTo('system-appbuilder', 'automator')).toContain('system-engineer/engineer');

    // The engineer is the ONLY caller of zerostack: its scratch sandbox cannot see the live data
    // directory, so it is the one agent whose limits make the escalation necessary.
    expect(delegatesTo('system-engineer', 'engineer')).toContain('system-zerostack/zerostack');
  });

  it('keeps zerostack a leaf — it drives a shell, it does not re-delegate', async () => {
    const spaces = await loadAll();
    expect(spaces.get('system-zerostack')!.agents['zerostack']!.canDelegateTo).toEqual([]);
  });
});
