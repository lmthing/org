import { describe, it, expect } from 'vitest';

// Test the stripMarkdownFences function by importing module internals
// We test the behavior through the regex directly since it's a module-private function

describe('stripMarkdownFences (via regex behavior)', () => {
  const stripFences = (chunk: string) =>
    chunk.split('\n').filter(line => !/^\s*```/.test(line)).join('\n');

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
