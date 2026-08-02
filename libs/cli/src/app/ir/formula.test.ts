/**
 * {@link compileFormula} — the closed compute-formula → JS-expression lowering (W7 / §7). Proves the
 * two scopes (row / agg), the arithmetic + aggregation operators, div-by-zero and null guards, the
 * forward-reference and settings-escape errors, and relation-ref collection for `include`.
 *
 * The generated expressions are evaluated with `new Function` over a fixed row/rows fixture so a
 * mis-lowering is a wrong NUMBER here, not just a shape mismatch.
 */
import { describe, it, expect } from 'vitest';

import {
  compileFormula,
  relationRefsInFormula,
  validateFormula,
  FormulaError,
  type Formula,
  type FormulaScope,
} from './formula.js';

const rowScope = (priorKeys: string[] = []): FormulaScope => ({
  kind: 'row',
  rowVar: 'r',
  rowsVar: 'rows',
  priorKeys: new Set(priorKeys),
});
const aggScope = (priorKeys: string[] = []): FormulaScope => ({
  kind: 'agg',
  rowVar: 'r',
  rowsVar: 'rows',
  priorKeys: new Set(priorKeys),
});

/** Evaluate a compiled row-scope expression against a single row. */
function evalRow(expr: string, r: Record<string, unknown>): unknown {
  return new Function('r', `return (${expr});`)(r);
}
/** Evaluate a compiled agg-scope expression against a row array. */
function evalAgg(expr: string, rows: Array<Record<string, unknown>>): unknown {
  return new Function('rows', `return (${expr});`)(rows);
}

describe('compileFormula — row scope', () => {
  it('reads a column ref and a numeric literal through arithmetic', () => {
    // labour = hours * 45  → 3 * 45 = 135
    const f: Formula = { mul: ['$hours', 45] };
    expect(evalRow(compileFormula(f, rowScope()), { hours: 3 })).toBe(135);
  });

  it('add/sub/min/max/round/neg compute the right numbers', () => {
    expect(evalRow(compileFormula({ add: ['$a', '$b'] }, rowScope()), { a: 2, b: 5 })).toBe(7);
    expect(evalRow(compileFormula({ sub: ['$a', '$b'] }, rowScope()), { a: 9, b: 4 })).toBe(5);
    expect(evalRow(compileFormula({ min: ['$a', '$b', 3] }, rowScope()), { a: 9, b: 4 })).toBe(3);
    expect(evalRow(compileFormula({ max: ['$a', '$b'] }, rowScope()), { a: 9, b: 4 })).toBe(9);
    expect(evalRow(compileFormula({ neg: '$a' }, rowScope()), { a: 4 })).toBe(-4);
    expect(evalRow(compileFormula({ round: [{ div: ['$a', '$b'] }, 2] }, rowScope()), { a: 10, b: 3 })).toBe(3.33);
  });

  it('guards div-by-zero to 0 (never Infinity/NaN)', () => {
    expect(evalRow(compileFormula({ div: ['$a', '$b'] }, rowScope()), { a: 5, b: 0 })).toBe(0);
  });

  it('coerces a null/missing column to 0 in arithmetic', () => {
    expect(evalRow(compileFormula({ add: ['$a', '$b'] }, rowScope()), { a: 5, b: null })).toBe(5);
    expect(evalRow(compileFormula({ add: ['$a', '$missing'] }, rowScope()), { a: 5 })).toBe(5);
  });

  it('a $ref to a PRIOR compute key resolves to its const, not a column', () => {
    // `$labour` is a prior key; the expression must reference the bare identifier `labour`.
    const expr = compileFormula({ add: ['$labour', '$parts'] }, rowScope(['labour', 'parts']));
    expect(expr).toContain('labour');
    expect(new Function('labour', 'parts', `return (${expr});`)(135, 75)).toBe(210);
  });

  it('sum/count over an included relation array', () => {
    const sum = compileFormula({ sum: '$parts.priceMinor' }, rowScope());
    expect(evalRow(sum, { parts: [{ priceMinor: 100 }, { priceMinor: 250 }] })).toBe(350);
    const count = compileFormula({ count: '$parts' }, rowScope());
    expect(evalRow(count, { parts: [{}, {}, {}] })).toBe(3);
    // a missing relation array degrades to 0, never throws
    expect(evalRow(sum, {})).toBe(0);
  });

  it('a bare relation-path ref (no agg op) is an error', () => {
    expect(() => compileFormula('$parts.priceMinor', rowScope())).toThrow(FormulaError);
  });
});

describe('compileFormula — aggregate scope', () => {
  const rows = [
    { amount: 100, status: 'paid' },
    { amount: 250, status: 'owed' },
    { amount: 50, status: 'paid' },
  ];

  it('sum/avg/count reduce over the whole set', () => {
    expect(evalAgg(compileFormula({ sum: '$amount' }, aggScope()), rows)).toBe(400);
    expect(evalAgg(compileFormula({ count: '' }, aggScope()), rows)).toBe(3);
    expect(evalAgg(compileFormula({ avg: '$amount' }, aggScope()), rows)).toBeCloseTo(133.33, 1);
  });

  it('a bare column ref in agg scope is an error (no current row)', () => {
    expect(() => compileFormula('$amount', aggScope())).toThrow(/no current row/);
  });

  it('arithmetic over prior aggregate keys', () => {
    const expr = compileFormula({ sub: ['$total', '$paid'] }, aggScope(['total', 'paid']));
    expect(new Function('total', 'paid', `return (${expr});`)(400, 150)).toBe(250);
  });
});

describe('compileFormula — errors', () => {
  it('rejects a forward reference to a not-yet-declared compute key', () => {
    // `$later` is neither a prior key nor (in agg scope) a column → error.
    expect(validateFormula({ add: ['$later', 1] }, aggScope())).toMatch(/no current row|column/);
  });

  it('rejects the { ref: settings } escape with actionable guidance', () => {
    expect(validateFormula({ ref: 'settings.labourRateMinor' } as unknown as Formula, rowScope())).toMatch(
      /settings store|belongs in a table|inline the constant/i,
    );
  });

  it('rejects a multi-key op object and a non-$ string operand', () => {
    expect(validateFormula({ add: [1], mul: [2] } as unknown as Formula, rowScope())).toMatch(/exactly one key/);
    expect(validateFormula('hours' as Formula, rowScope())).toMatch(/\$ref/);
  });
});

describe('relationRefsInFormula', () => {
  it('collects relation names from $rel.field aggregation paths only', () => {
    const f: Formula = { add: [{ sum: '$parts.priceMinor' }, { count: '$notes' }, '$hours'] };
    expect([...relationRefsInFormula(f)].sort()).toEqual(['notes', 'parts']);
  });
});
