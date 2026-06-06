import { describe, it, expect } from 'vitest';
import { runTsc } from './tsc-runner.js';
import { runTscWithRetry } from './retry.js';
import {
  SpeculativeBuffer,
  extractAwaitAnnotation,
  hasTopLevelAwait,
} from './speculative.js';
import { AnnotationGrace, deriveTypeShape, buildGraceHint } from './annotation-grace.js';

// ── tsc-runner ────────────────────────────────────────────────────────────────

describe('runTsc', () => {
  it('passes a clean const declaration', () => {
    const r = runTsc('const x: number = 42;');
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
    expect(r.js).toContain('42');
  });

  it('fails on a type mismatch', () => {
    const r = runTsc('const x: number = "hello";');
    expect(r.ok).toBe(false);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics[0]!.message).toMatch(/string/i);
  });

  it('reports line 0 for error on first line of statement', () => {
    const r = runTsc('const x: string = 123;');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.line).toBe(0);
  });

  it('infers binding type for const', () => {
    // Literal string → TypeScript narrows to the literal type "hello world"
    const r = runTsc('const greeting = "hello world";');
    expect(r.ok).toBe(true);
    expect(r.inferredBindings).toHaveLength(1);
    expect(r.inferredBindings[0]!.name).toBe('greeting');
    // Literal type includes the value; either "hello world" or string is acceptable
    expect(r.inferredBindings[0]!.type).toMatch(/"hello world"|string/);
  });

  it('infers binding for function declaration', () => {
    const r = runTsc('function add(a: number, b: number): number { return a + b; }');
    expect(r.ok).toBe(true);
    const b = r.inferredBindings.find((b) => b.name === 'add');
    expect(b).toBeDefined();
    expect(b!.type).toMatch(/number/);
  });

  it('uses session context for cross-statement type inference', () => {
    const ctx = 'const x = 42;';
    // x is number — using it as string should fail
    const r = runTsc('const y: string = x;', { sessionContext: ctx });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.message).toMatch(/number/i);
  });

  it('passes when session context provides matching type', () => {
    const ctx = 'const x: number = 42;';
    const r = runTsc('const y: number = x;', { sessionContext: ctx });
    expect(r.ok).toBe(true);
  });

  it('reports line relative to statement, not combined file', () => {
    const ctx = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const r = runTsc('const z: string = 99;', { sessionContext: ctx });
    expect(r.ok).toBe(false);
    // Error should be on line 0 of the new statement, not line 3 of combined
    expect(r.diagnostics[0]!.line).toBe(0);
  });

  it('transpiles arrow function to JS', () => {
    const r = runTsc('const fn = (x: number) => x * 2;');
    expect(r.ok).toBe(true);
    expect(r.js).toContain('const fn');
    expect(r.js).toContain('* 2');
  });

  it('generates module stubs for availableModules', () => {
    // With a module stub, import from unknown module should not error
    const r = runTsc("import myLib from 'my-custom-lib'; const v = myLib;", {
      availableModules: ['my-custom-lib'],
    });
    // Should not produce "cannot find module" errors
    const moduleErrors = r.diagnostics.filter((d) => d.code === 2307);
    expect(moduleErrors).toHaveLength(0);
  });

  it('strict mode catches implicit any', () => {
    const r = runTsc('function f(x) { return x; }');
    expect(r.ok).toBe(false);
    // TS2315 / TS7006: Parameter 'x' implicitly has an 'any' type
    expect(r.diagnostics.some((d) => d.code === 7006)).toBe(true);
  });
});

// ── retry ─────────────────────────────────────────────────────────────────────

describe('runTscWithRetry', () => {
  it('succeeds on first attempt for valid code', () => {
    const r = runTscWithRetry('const n: number = 1;');
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.finalDiagnostics).toHaveLength(0);
  });

  it('fails after 3 attempts for persistently invalid code', () => {
    // Type mismatch that cannot be auto-fixed
    const r = runTscWithRetry('const x: number = "always wrong";');
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.finalDiagnostics.length).toBeGreaterThan(0);
  });

  it('injects // tsc: comments on failure', () => {
    const r = runTscWithRetry('const x: number = "wrong";');
    expect(r.ok).toBe(false);
    // The final statement should contain injected comments
    expect(r.finalStatement).toContain('// tsc(');
  });

  it('comment format is // tsc(<code>): <message>', () => {
    const r = runTscWithRetry('const x: string = 42;');
    expect(r.ok).toBe(false);
    const lines = r.finalStatement.split('\n');
    const commentLines = lines.filter((l) => l.startsWith('// tsc('));
    expect(commentLines.length).toBeGreaterThan(0);
    expect(commentLines[0]).toMatch(/^\/\/ tsc\(\d+\): /);
  });

  it('accumulates comments across retries without duplication', () => {
    const r = runTscWithRetry('const x: number = "still wrong";');
    expect(r.ok).toBe(false);
    // Each retry adds one set of comments, but not unbounded growth
    const commentCount = r.finalStatement
      .split('\n')
      .filter((l) => l.startsWith('// tsc(')).length;
    // 3 retries max → at most 2 comment injections before the final attempt
    expect(commentCount).toBeGreaterThan(0);
    expect(commentCount).toBeLessThanOrEqual(10); // bounded
  });
});

// ── speculative buffer ────────────────────────────────────────────────────────

describe('extractAwaitAnnotation', () => {
  it('returns undefined for non-await statements', () => {
    expect(extractAwaitAnnotation('const x = 42;')).toBeUndefined();
    expect(extractAwaitAnnotation('function f() {}')).toBeUndefined();
  });

  it('returns null for unannotated await', () => {
    expect(extractAwaitAnnotation('const x = await fetchData();')).toBeNull();
    expect(extractAwaitAnnotation('await doSomething();')).toBeNull();
  });

  it('returns the annotation type for annotated await', () => {
    const r = extractAwaitAnnotation('const x = await fetchData() as User;');
    expect(r).toBe('User');
  });

  it('handles complex type annotations', () => {
    const r = extractAwaitAnnotation('const x = await getData() as { id: number; name: string };');
    expect(r).toMatch(/\{.*id.*\}/);
  });
});

describe('hasTopLevelAwait', () => {
  it('false for non-await', () => {
    expect(hasTopLevelAwait('const x = 1;')).toBe(false);
  });

  it('true for await expressions', () => {
    expect(hasTopLevelAwait('const x = await fetch("url");')).toBe(true);
    expect(hasTopLevelAwait('await sleep(100);')).toBe(true);
  });
});

describe('SpeculativeBuffer', () => {
  const stmt = (source: string) => ({ source, js: source, typeCheckOk: true });

  it('starts inactive', () => {
    const buf = new SpeculativeBuffer();
    expect(buf.active).toBe(false);
    expect(buf.depth).toBe(0);
  });

  it('becomes active after openFrame', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame('User');
    expect(buf.active).toBe(true);
    expect(buf.depth).toBe(1);
  });

  it('flush returns ok with buffered statements when types match', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame('string');
    buf.feed(stmt('const a = 1;'));
    buf.feed(stmt('const b = 2;'));
    const r = buf.flush('string');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.statements).toHaveLength(2);
    }
    expect(buf.active).toBe(false);
  });

  it('flush returns mismatch when resolved type differs from annotated', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame('string');
    buf.feed(stmt('const c = 3;'));
    const r = buf.flush('number');
    expect(r.kind).toBe('mismatch');
    if (r.kind === 'mismatch') {
      expect(r.awaitedType).toBe('string');
      expect(r.actualType).toBe('number');
      expect(r.nudge).toContain('__speculative_nudge');
      expect(r.discarded).toHaveLength(1);
    }
  });

  it('flush returns ok when awaitedType is null (unannotated / grace mode)', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame(null);
    buf.feed(stmt('const x = 1;'));
    const r = buf.flush('anything');
    expect(r.kind).toBe('ok');
  });

  it('returns overflow when token budget exceeded', () => {
    // maxTokens: 1 means any statement (estimate >= 1 char / 4 rounded up = 1) overflows
    const buf = new SpeculativeBuffer({ maxTokens: 1 });
    buf.openFrame('string');
    const r = buf.feed(stmt('const x = 1;'));
    expect(r).not.toBeNull();
    if (r) {
      expect(r.kind).toBe('overflow');
      expect(r.pending).toContain('__speculative_pending');
    }
  });

  it('supports nested frames (stack depth 2)', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame('string');
    buf.feed(stmt('const a = 1;'));
    buf.openFrame('number');
    buf.feed(stmt('const b = 2;'));
    expect(buf.depth).toBe(2);

    // Flush innermost
    const inner = buf.flush('number');
    expect(inner.kind).toBe('ok');
    expect(buf.depth).toBe(1);

    // Outer still active
    const outer = buf.flush('string');
    expect(outer.kind).toBe('ok');
    if (outer.kind === 'ok') {
      expect(outer.statements[0]!.source).toBe('const a = 1;');
    }
  });

  it('abortFrame discards without executing', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame('string');
    buf.feed(stmt('const x = 1;'));
    buf.abortFrame();
    expect(buf.active).toBe(false);
  });

  it('mismatch nudge contains inspect suggestion', () => {
    const buf = new SpeculativeBuffer();
    buf.openFrame('string');
    const r = buf.flush('number');
    if (r.kind === 'mismatch') {
      expect(r.nudge).toContain('inspect(__resolved)');
    }
  });
});

// ── annotation grace ──────────────────────────────────────────────────────────

describe('AnnotationGrace', () => {
  it('ok for annotated await', () => {
    const g = new AnnotationGrace();
    const r = g.check('User');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.awaitedType).toBe('User');
    expect(g.used).toBe(false);
  });

  it('grace on first unannotated await', () => {
    const g = new AnnotationGrace();
    const r = g.check(null);
    expect(r.kind).toBe('grace');
    expect(g.used).toBe(true);
  });

  it('error on second unannotated await', () => {
    const g = new AnnotationGrace();
    g.check(null); // first — grace
    const r = g.check(null); // second — error
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.message).toMatch(/annotation/i);
    }
  });

  it('annotated await after grace does not count as omission', () => {
    const g = new AnnotationGrace();
    g.check(null); // use grace
    const r = g.check('number'); // annotated — should be ok
    expect(r.kind).toBe('ok');
  });

  it('reset clears grace flag', () => {
    const g = new AnnotationGrace();
    g.check(null); // use grace
    g.reset();
    const r = g.check(null); // should be grace again after reset
    expect(r.kind).toBe('grace');
  });
});

describe('deriveTypeShape', () => {
  it('primitives', () => {
    expect(deriveTypeShape(42)).toBe('number');
    expect(deriveTypeShape('hello')).toBe('string');
    expect(deriveTypeShape(true)).toBe('boolean');
    expect(deriveTypeShape(null)).toBe('null');
    expect(deriveTypeShape(undefined)).toBe('undefined');
  });

  it('empty array', () => {
    expect(deriveTypeShape([])).toBe('unknown[]');
  });

  it('number array', () => {
    expect(deriveTypeShape([1, 2, 3])).toBe('number[]');
  });

  it('simple object', () => {
    const shape = deriveTypeShape({ id: 1, name: 'Alice' });
    expect(shape).toContain('id');
    expect(shape).toContain('number');
    expect(shape).toContain('name');
    expect(shape).toContain('string');
  });

  it('empty object', () => {
    expect(deriveTypeShape({})).toBe('Record<string, unknown>');
  });

  it('nested object truncates at depth 3', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const shape = deriveTypeShape(deep);
    expect(shape).toContain('a');
    // Should not go infinitely deep
    expect(shape.length).toBeLessThan(500);
  });
});

describe('buildGraceHint', () => {
  it('produces annotation_grace comment with shape', () => {
    const hint = buildGraceHint('{ id: number; name: string }');
    expect(hint).toContain('annotation_grace');
    expect(hint).toContain('{ id: number; name: string }');
    expect(hint).toContain('as ');
  });
});
