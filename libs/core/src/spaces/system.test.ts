import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadSystemSpaces,
  systemFunctionNames,
  systemFunctionSources,
  defaultSystemSpaceDirs,
} from './system.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/spaces → libs/core/system-spaces
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');
const GLOBAL_DIR = join(SYSTEM_SPACES_ROOT, 'system-global');
const ARCHITECT_DIR = join(SYSTEM_SPACES_ROOT, 'system-architect');

describe('system spaces', () => {
  it('loads the system-global system space (no agents/ required)', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    expect(spaces.length).toBe(1);
    const global = spaces[0]!;
    // The generic fs wrappers (readFile/writeFile/editFile/listDir/glob/grep) were REMOVED
    // from system-global (they mis-rooted at the caller's space dir). They now live only in
    // system-engineer/functions, scoped to the engineer + jailed to a scratch sandbox.
    expect(Object.keys(global.functions).sort()).toEqual([
      'forget', 'recall', 'recallAll', 'remember',
      'todoRead', 'todoWrite', 'webFetch', 'webSearch',
    ]);
  });

  it('exposes system-global function names universally', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    const names = systemFunctionNames(spaces);
    expect(names.has('webSearch')).toBe(true);
    expect(names.has('remember')).toBe(true);
    // the generic fs wrappers are no longer universal — they moved to system-engineer.
    expect(names.has('readFile')).toBe(false);
    expect(names.has('grep')).toBe(false);
  });

  it('ONLY system-global functions are universal — agent-bearing spaces stay scoped', async () => {
    // system-global + system-architect loaded together: the toolkit is universal, but
    // the architect's own functions are NOT (they reach the architect via its frontmatter).
    const spaces = await loadSystemSpaces([GLOBAL_DIR, ARCHITECT_DIR]);
    const universal = systemFunctionSources(spaces);
    expect('webSearch' in universal).toBe(true);
    expect('remember' in universal).toBe(true);
    // fs wrappers are engineer-scoped now, not universal.
    expect('readFile' in universal).toBe(false);
    expect('writeTaskFile' in universal).toBe(false);
    expect('writeAgentFile' in universal).toBe(false);
    expect('validateSpace' in universal).toBe(false);
  });

  it('defaultSystemSpaceDirs points under libs/core/system-spaces', () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.some((d) => d.endsWith('system-spaces/system-global'))).toBe(true);
    expect(dirs.length).toBe(10);
    expect(dirs.some((d) => d.endsWith('system-spaces/solver'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-research'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-appbuilder'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-vision'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-files'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-store'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-google'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-slack'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-github'))).toBe(false);
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
