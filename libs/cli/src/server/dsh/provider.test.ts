import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDshModel, loadAgentPersona } from './provider.js';

describe('resolveDshModel', () => {
  it('prefers LMTHING_DSH_MODEL', () => {
    expect(resolveDshModel('azure:X', { LMTHING_DSH_MODEL: 'Custom' })).toBe('Custom');
  });
  it('strips a provider prefix from the default model spec', () => {
    expect(resolveDshModel('lmthingcloud:DeepSeek-V4-Flash', {})).toBe('DeepSeek-V4-Flash');
    expect(resolveDshModel('DeepSeek-V4-Pro', {})).toBe('DeepSeek-V4-Pro');
  });
  it('falls back to a default when nothing is set', () => {
    expect(resolveDshModel(undefined, {})).toBe('DeepSeek-V4-Flash');
  });
});

describe('loadAgentPersona', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'space-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('concatenates charter and frontmatter-stripped instruct', () => {
    const dir = join(root, 'agents', 'thing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'charter.md'), 'You are THING.');
    writeFileSync(join(dir, 'instruct.md'), '---\ntitle: THING\n---\nAlways be helpful.');
    const persona = loadAgentPersona(root, 'thing');
    expect(persona).toBe('You are THING.\n\nAlways be helpful.');
  });

  it('returns empty string when the agent has no files', () => {
    expect(loadAgentPersona(root, 'missing')).toBe('');
  });
});
