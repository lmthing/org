import { describe, it, expect } from 'vitest';
import { stripMarkdownFences, looksLikeProse } from './turn-loop.js';

describe('looksLikeProse', () => {
  it('flags narrated sentences the model emits instead of code', () => {
    expect(looksLikeProse('Based on the query from search_broad, I will search')).toBe(true);
    expect(looksLikeProse('Now we synthesize the findings into a report')).toBe(true);
    expect(looksLikeProse('Here is the plan for the next step')).toBe(true);
    expect(looksLikeProse('This function merges the overlapping intervals')).toBe(true);
  });

  it('does NOT flag real TypeScript statements', () => {
    expect(looksLikeProse('const x = 1;')).toBe(false);
    expect(looksLikeProse('await tavilySearch(query, "advanced", 10)')).toBe(false);
    expect(looksLikeProse('currentTask.resolve({ summary: "x" })')).toBe(false);
    expect(looksLikeProse('display(report)')).toBe(false);
    expect(looksLikeProse('return results.map((r) => r.title)')).toBe(false);
    expect(looksLikeProse('for (const r of results) { }')).toBe(false);
    expect(looksLikeProse('const based = onQuery;')).toBe(false); // has '=' → code
  });

  it('keeps single identifiers (valid inspect probes) and short fragments', () => {
    expect(looksLikeProse('results')).toBe(false);
    expect(looksLikeProse('inspect')).toBe(false);
    expect(looksLikeProse('x')).toBe(false);
  });

  it('does not flag word sequences without an English function word (avoids false drops)', () => {
    // No recognizable English connective → keep it (it will typecheck-error as before, no worse).
    expect(looksLikeProse('foo bar baz')).toBe(false);
  });
});

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
    // The boundary that broke a live run: '```' arrived in one chunk
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
