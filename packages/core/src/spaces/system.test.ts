import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSpace } from './load.js';
import {
  loadSystemSpaces,
  mergeSystemInto,
  systemFunctionNames,
  defaultSystemSpaceDirs,
} from './system.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/spaces → packages/core/system-spaces
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');
const FS_DIR = join(SYSTEM_SPACES_ROOT, 'fs');
const FIXTURES = join(__dirname, '..', '..', '..', '..', 'fixtures');

describe('system spaces', () => {
  it('loads the fs system space (no agents/ required)', async () => {
    const spaces = await loadSystemSpaces([FS_DIR]);
    expect(spaces.length).toBe(1);
    const fs = spaces[0]!;
    expect(Object.keys(fs.functions).sort()).toEqual(
      ['editFile', 'glob', 'grep', 'listDir', 'readFile', 'writeFile'],
    );
  });

  it('exposes function names', async () => {
    const spaces = await loadSystemSpaces([FS_DIR]);
    const names = systemFunctionNames(spaces);
    expect(names.has('readFile')).toBe(true);
    expect(names.has('grep')).toBe(true);
  });

  it('merges system functions into a user space (user wins on collision)', async () => {
    const userSpace = await loadSpace(join(FIXTURES, 'cooking'));
    const systemSpaces = await loadSystemSpaces([FS_DIR]);
    const merged = mergeSystemInto(userSpace, systemSpaces);

    // System functions present
    expect('readFile' in merged.functions).toBe(true);
    expect('grep' in merged.functions).toBe(true);
    // User functions preserved
    for (const fn of Object.keys(userSpace.functions)) {
      expect(merged.functions[fn]).toBe(userSpace.functions[fn]);
    }
    // User agents preserved
    expect(Object.keys(merged.agents)).toEqual(Object.keys(userSpace.agents));
  });

  it('user space overrides a system function of the same name', async () => {
    const systemSpaces = await loadSystemSpaces([FS_DIR]);
    const fakeUser = {
      ...(await loadSpace(join(FIXTURES, 'cooking'))),
      functions: { readFile: 'export function readFile() { return "custom"; }' },
      functionsBundled: {},
    };
    const merged = mergeSystemInto(fakeUser, systemSpaces);
    expect(merged.functions['readFile']).toContain('custom');
  });

  it('an EMPTY placeholder user agent does NOT shadow a real system agent of the same slug', async () => {
    // Regression: an `agents/architect/` dir with no instruct.md loaded as an empty
    // AgentDef and overrode the real system architect, stripping its instructions,
    // actions, and defaultAction — so the architect ran with a generic, empty prompt.
    const systemSpaces = await loadSystemSpaces([FS_DIR]); // fs has no agents
    const sysAgent = { slug: 'architect', title: 'Architect', instructBody: 'Real architect prompt.', actions: [{ id: 'synthesize_and_run', label: 'S', description: 'd', tasklist: 'synthesize_and_run' }], dependencies: [], config: { knowledge: [], functions: [], components: [] }, defaultAction: 'synthesize_and_run' };
    const sysWithAgent = { ...systemSpaces[0]!, agents: { architect: sysAgent } };
    const emptyPlaceholder = { slug: 'architect', title: 'architect', instructBody: '', actions: [], dependencies: [], config: { knowledge: [], functions: [], components: [] } };
    const userSpace = { ...(await loadSpace(join(FIXTURES, 'cooking'))), agents: { architect: emptyPlaceholder } };

    const merged = mergeSystemInto(userSpace as never, [sysWithAgent] as never);
    expect(merged.agents['architect']!.instructBody).toBe('Real architect prompt.');
    expect(merged.agents['architect']!.defaultAction).toBe('synthesize_and_run');
    expect(merged.agents['architect']!.actions.length).toBe(1);
  });

  it('a non-empty user agent still wins over a system agent of the same slug', async () => {
    const sysAgent = { slug: 'architect', title: 'Architect', instructBody: 'system', actions: [], dependencies: [], config: { knowledge: [], functions: [], components: [] } };
    const sysWithAgent = { ...(await loadSystemSpaces([FS_DIR]))[0]!, agents: { architect: sysAgent } };
    const userAgent = { slug: 'architect', title: 'Mine', instructBody: 'custom user architect', actions: [], dependencies: [], config: { knowledge: [], functions: [], components: [] } };
    const userSpace = { ...(await loadSpace(join(FIXTURES, 'cooking'))), agents: { architect: userAgent } };
    const merged = mergeSystemInto(userSpace as never, [sysWithAgent] as never);
    expect(merged.agents['architect']!.instructBody).toBe('custom user architect');
  });

  it('defaultSystemSpaceDirs points under packages/core/system-spaces', () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.some((d) => d.endsWith('system-spaces/fs'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/solver'))).toBe(true);
    expect(dirs.length).toBe(8);
    expect(dirs.some((d) => d.endsWith('system-spaces/deep_research'))).toBe(true);
  });

  it('defaultSystemSpaceDirs resolves to dirs that actually exist (dist + src layouts)', () => {
    // Probing both layouts means the path is real whether run from dist/ or src/.
    const dirs = defaultSystemSpaceDirs();
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/fs'))!)).toBe(true);
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/web'))!)).toBe(true);
  });
});
