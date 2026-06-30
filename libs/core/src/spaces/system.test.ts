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
  systemFunctionSources,
  defaultSystemSpaceDirs,
} from './system.js';
import { getAgentFunctions } from './agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/spaces → libs/core/system-spaces
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');
const GLOBAL_DIR = join(SYSTEM_SPACES_ROOT, 'system-global');
const ARCHITECT_DIR = join(SYSTEM_SPACES_ROOT, 'system-architect');
const FIXTURES = join(__dirname, '..', '..', '..', '..', 'fixtures');

describe('system spaces', () => {
  it('loads the system-global system space (no agents/ required)', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    expect(spaces.length).toBe(1);
    const global = spaces[0]!;
    expect(Object.keys(global.functions).sort()).toEqual([
      'editFile', 'forget', 'glob', 'grep', 'listDir', 'readFile', 'recall',
      'recallAll', 'remember', 'todoRead', 'todoWrite', 'webFetch', 'webSearch', 'writeFile',
    ]);
  });

  it('exposes system-global function names universally', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    const names = systemFunctionNames(spaces);
    expect(names.has('readFile')).toBe(true);
    expect(names.has('grep')).toBe(true);
    expect(names.has('webSearch')).toBe(true);
  });

  it('ONLY system-global functions are universal — agent-bearing spaces stay scoped', async () => {
    // system-global + system-architect loaded together: the toolkit is universal, but
    // the architect's own functions are NOT (they reach the architect via its frontmatter).
    const spaces = await loadSystemSpaces([GLOBAL_DIR, ARCHITECT_DIR]);
    const universal = systemFunctionSources(spaces);
    expect('readFile' in universal).toBe(true);
    expect('webSearch' in universal).toBe(true);
    expect('writeTaskFile' in universal).toBe(false);
    expect('writeAgentFile' in universal).toBe(false);
    expect('validateSpace' in universal).toBe(false);
  });

  it('architect functions reach the architect agent via getAgentFunctions', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR, ARCHITECT_DIR]);
    const userSpace = await loadSpace(join(FIXTURES, 'cooking'));
    const merged = mergeSystemInto(userSpace, spaces);
    const architect = merged.agents['architect']!;
    expect(architect).toBeTruthy();
    const fns = getAgentFunctions(merged, architect);
    // The architect builds spaces one file at a time via the per-file builders.
    expect('writeAgentFile' in fns).toBe(true);
    expect('writeTaskFile' in fns).toBe(true);
    expect('validateSpace' in fns).toBe(true);
    // The cooking chef declares none of the architect functions → does not get them.
    const chef = merged.agents['chef']!;
    const chefFns = getAgentFunctions(merged, chef);
    expect('writeAgentFile' in chefFns).toBe(false);
    expect('writeTaskFile' in chefFns).toBe(false);
  });

  it('merges system functions into a user space (user wins on collision)', async () => {
    const userSpace = await loadSpace(join(FIXTURES, 'cooking'));
    const systemSpaces = await loadSystemSpaces([GLOBAL_DIR]);
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
    const systemSpaces = await loadSystemSpaces([GLOBAL_DIR]);
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
    const systemSpaces = await loadSystemSpaces([GLOBAL_DIR]); // global has no agents
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
    const sysWithAgent = { ...(await loadSystemSpaces([GLOBAL_DIR]))[0]!, agents: { architect: sysAgent } };
    const userAgent = { slug: 'architect', title: 'Mine', instructBody: 'custom user architect', actions: [], dependencies: [], config: { knowledge: [], functions: [], components: [] } };
    const userSpace = { ...(await loadSpace(join(FIXTURES, 'cooking'))), agents: { architect: userAgent } };
    const merged = mergeSystemInto(userSpace as never, [sysWithAgent] as never);
    expect(merged.agents['architect']!.instructBody).toBe('custom user architect');
  });

  it('defaultSystemSpaceDirs points under libs/core/system-spaces', () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.some((d) => d.endsWith('system-spaces/system-global'))).toBe(true);
    expect(dirs.length).toBe(6);
    expect(dirs.some((d) => d.endsWith('system-spaces/solver'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-deep-research'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/user-memory'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/user-thing'))).toBe(true);
  });

  it('defaultSystemSpaceDirs resolves to dirs that actually exist (dist + src layouts)', () => {
    // Probing both layouts means the path is real whether run from dist/ or src/.
    const dirs = defaultSystemSpaceDirs();
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/system-global'))!)).toBe(true);
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/system-architect'))!)).toBe(true);
  });
});
