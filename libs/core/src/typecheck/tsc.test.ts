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
});
