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

  it('defaultSystemSpaceDirs points under libs/core/system-spaces', () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.some((d) => d.endsWith('system-spaces/system-global'))).toBe(true);
    expect(dirs.length).toBe(9);
    expect(dirs.some((d) => d.endsWith('system-spaces/solver'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-research'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-appbuilder'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-vision'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-files'))).toBe(true);
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
