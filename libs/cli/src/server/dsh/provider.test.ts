import { describe, it, expect } from 'vitest';
import { resolveDshModel } from './provider.js';

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
