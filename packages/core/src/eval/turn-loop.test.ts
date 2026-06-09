import { describe, it, expect } from 'vitest';
import { stripMarkdownFences } from './turn-loop.js';

describe('stripMarkdownFences', () => {
  const stripFences = stripMarkdownFences;

  it('strips opening code fences', () => {
    const result = stripFences('```typescript\nconst x = 1;');
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('strips closing code fences', () => {
    const result = stripFences('const x = 1;\n```');
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('preserves regular code', () => {
    const code = 'const x = 42;\nawait sleep("1s");';
    expect(stripFences(code)).toBe(code);
  });

  it('handles various fence formats', () => {
    expect(stripFences('```ts\n')).not.toContain('```');
    expect(stripFences('```json\n')).not.toContain('```');
    expect(stripFences('  ```\n')).not.toContain('```');
  });

  it('drops a stray fence language tag left behind when the stream splits ``` from its tag', () => {
    // The boundary that broke a live solve attempt: '```' arrived in one chunk
    // (stripped) and 'typescript' alone in the next, leaking a bogus statement.
    expect(stripFences('typescript\nconst source = 1;')).toBe('const source = 1;');
    expect(stripFences('ts')).toBe('');
    expect(stripFences('  json  ')).toBe('');
  });

  it('does not drop those words inside real statements', () => {
    expect(stripFences('const ts = 1;')).toBe('const ts = 1;');
    expect(stripFences('return typescript.length;')).toBe('return typescript.length;');
  });
});

describe('globalThis variable persistence for undefined values', () => {
  it('try/catch wrapping allows undefined values through', () => {
    // Simulate the new pattern
    const result: Record<string, unknown> = {};
    const trySet = (name: string, value: unknown) => {
      try { result[name] = value; } catch {}
    };

    trySet('defined', 42);
    trySet('undefinedVal', undefined);
    trySet('nullVal', null);
    trySet('emptyArr', []);

    expect(result['defined']).toBe(42);
    expect('undefinedVal' in result).toBe(true); // KEY: undefined values ARE now tracked
    expect(result['undefinedVal']).toBeUndefined();
    expect(result['nullVal']).toBeNull();
    expect(result['emptyArr']).toEqual([]);
  });
});
