import { describe, expect, it, vi } from 'vitest';
import { parseEnvContent, mergeEnvContent, applyEnv, readEnvVar } from './env.mjs';

describe('parseEnvContent', () => {
  it('parses KEY=VALUE lines, skipping blanks and comments', () => {
    const map = parseEnvContent('# comment\nFOO=bar\n\nBAZ=1=2\n');
    expect(map.get('FOO')).toBe('bar');
    expect(map.get('BAZ')).toBe('1=2'); // only the FIRST "=" splits key from value
    expect(map.has('# comment')).toBe(false);
  });
  it('returns an empty map for empty/undefined content', () => {
    expect(parseEnvContent(undefined).size).toBe(0);
    expect(parseEnvContent('').size).toBe(0);
  });
});

describe('mergeEnvContent', () => {
  it('rewrites an existing key in place, leaving every other line untouched', () => {
    const before = '# header\nFOO=bar\nBAZ=1\n';
    const after = mergeEnvContent(before, { FOO: 'blanked-or-new' });
    expect(after).toBe('# header\nFOO=blanked-or-new\nBAZ=1\n');
  });
  it('appends a key absent from the file', () => {
    const after = mergeEnvContent('FOO=bar\n', { NEW_KEY: 'x' });
    expect(after).toBe('FOO=bar\nNEW_KEY=x\n');
  });
  it('blanks a key to an explicit empty string (not removing the line)', () => {
    const after = mergeEnvContent('TAVILY_API_KEY=real-secret\n', { TAVILY_API_KEY: '' });
    expect(after).toBe('TAVILY_API_KEY=\n');
  });
});

describe('applyEnv', () => {
  it('GETs, merges, PUTs, and returns only key NAMES (never a value) plus the pre-mutation content', async () => {
    const putEnv = vi.fn().mockResolvedValue({ ok: true });
    const pod = { getEnv: vi.fn().mockResolvedValue({ content: 'TAVILY_API_KEY=shh-secret\nOTHER=1\n' }), putEnv };
    const result = await applyEnv(pod, { TAVILY_API_KEY: '' });
    expect(putEnv).toHaveBeenCalledWith('TAVILY_API_KEY=\nOTHER=1\n');
    expect(result.keys).toEqual(['TAVILY_API_KEY']);
    expect(result.previousContent).toBe('TAVILY_API_KEY=shh-secret\nOTHER=1\n');
    expect(JSON.stringify(result.keys)).not.toContain('shh-secret'); // the secret never rides in what a step records
  });
});

describe('readEnvVar', () => {
  it("reads a single key's current value from the pod", async () => {
    const pod = { getEnv: vi.fn().mockResolvedValue({ content: 'WEBHOOK_SECRET=whsec-abc\n' }) };
    expect(await readEnvVar(pod, 'WEBHOOK_SECRET')).toBe('whsec-abc');
    expect(await readEnvVar(pod, 'MISSING')).toBeUndefined();
  });
});
