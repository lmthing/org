import { describe, it, expect } from 'vitest';
import { runTsc } from './tsc.js';
import { LIBRARY_DTS } from './library-dts.js';

describe('runTsc', () => {
  it('passes valid TypeScript', () => {
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext: '',
      statement: 'const x: number = 42;',
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('reports type error for wrong assignment', () => {
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext: '',
      statement: 'const x: number = "not a number";',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.message).toMatch(/not assignable/i);
  });

  it('carries context from previous statements', () => {
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext: 'const greeting: string = "hello";',
      statement: 'const len: number = greeting.length;',
    });
    expect(result.ok).toBe(true);
  });

  it('detects reference to undefined variable', () => {
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext: '',
      statement: 'const y = undeclaredVar + 1;',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.message).toMatch(/undeclaredVar/i);
  });

  it('filters diagnostics to statement line range only', () => {
    const sessionContext = 'const validPrior: number = 10;';
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext,
      statement: 'const bad: number = "wrong";',
    });
    // Should only report the error in the statement, not prior context
    expect(result.ok).toBe(false);
    for (const d of result.diagnostics) {
      expect(d.line).toBe(0); // line 0 within the statement
    }
  });

  it('recognizes library globals like ask', () => {
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext: '',
      statement: 'const x = ask({ type: "form", props: {}, children: [] });',
    });
    // Should not error about ask being undefined
    const askUndefined = result.diagnostics.some((d) => d.message.includes('ask'));
    expect(askUndefined).toBe(false);
  });

  it('reports line 0 for single-line statement error', () => {
    const result = runTsc({
      ambientDts: LIBRARY_DTS,
      sessionContext: '',
      statement: 'const n: string = 99;',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.line).toBe(0);
  });

  // Each statement is its own module at runtime, so a fresh `const x` shadows the carried-over
  // `globalThis.x`. Replaying the context as one scope used to call that a redeclaration — and then
  // refuse the reassignment too ("Cannot assign to 'x' because it is a constant"), leaving the model
  // no legal move at all. Live 10-family-recipes run: the architect burned all 3 retries ping-ponging
  // between those two errors on a name it had already bound.
  describe('rebinding a name the context already bound (runtime shadowing)', () => {
    it('allows a statement to REDECLARE a context binding', () => {
      const result = runTsc({
        ambientDts: LIBRARY_DTS,
        sessionContext: 'const functions = [{ name: "a", purpose: "b" }];',
        statement: 'const functions: { name: string; purpose: string }[] = [];',
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('allows a redeclaration of a different type (the new declaration wins)', () => {
      const result = runTsc({
        ambientDts: LIBRARY_DTS,
        sessionContext: 'const slug = "greek";',
        statement: 'const slug = 42;',
      });
      expect(result.ok).toBe(true);
    });

    it('rebinds a function/class declaration too', () => {
      const result = runTsc({
        ambientDts: LIBRARY_DTS,
        sessionContext: 'function build() { return 1; }',
        statement: 'function build() { return "two"; }',
      });
      expect(result.ok).toBe(true);
    });

    it('keeps a co-declared name resolvable when only its sibling is rebound', () => {
      const result = runTsc({
        ambientDts: LIBRARY_DTS,
        sessionContext: 'const { fields, actionId } = { fields: [1], actionId: "x" };',
        statement: 'const fields = [2]; const also = actionId;',
      });
      // `actionId` was collateral of the blanked declaration — still resolvable (as any).
      expect(result.ok).toBe(true);
    });

    it('does NOT weaken type fidelity for bindings the statement leaves alone', () => {
      const result = runTsc({
        ambientDts: LIBRARY_DTS,
        sessionContext: 'const count = 5;\nconst label = "x";',
        statement: 'const label = "y"; const bad: string = count;',
      });
      // `count` is untouched by the statement, so it keeps its real type — number is not a string.
      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((d) => /not assignable to type 'string'/.test(d.message))).toBe(true);
    });

    it('keeps diagnostic line numbers correct after blanking a multi-line declaration', () => {
      const result = runTsc({
        ambientDts: LIBRARY_DTS,
        sessionContext: 'const cfg = {\n  a: 1,\n  b: 2,\n};',
        statement: 'const cfg = 1;\nconst n: string = 99;',
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]!.line).toBe(1); // 2nd line OF THE STATEMENT, not of the file
    });
  });
});
