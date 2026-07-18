import { describe, it, expect } from 'vitest';
import { applyQuery, formatInspectResult } from './inspect.js';

/**
 * Unit coverage for inspect()'s query engine. The end-to-end path (path/keys/count
 * through a real Session) lives in testing/harness-features.test.ts; here we pin the
 * pure transforms — especially filter/slice/search/sample, which the session test
 * doesn't reach — plus the VARIABLES formatter.
 */

describe('applyQuery', () => {
  it('path: walks a dotted path through objects and arrays', () => {
    expect(applyQuery({ a: { b: { c: 7 } } }, { path: 'a.b.c' })).toBe(7);
    expect(applyQuery({ items: [10, 20, 30] }, { path: 'items.1' })).toBe(20);
    expect(applyQuery({ a: 1 }, { path: 'a.missing' })).toBeUndefined();
  });

  it('keys: returns the object keys', () => {
    expect(applyQuery({ x: 1, y: 2, z: 3 }, { keys: true })).toEqual(['x', 'y', 'z']);
  });

  it('count: length of arrays/strings, key count of objects', () => {
    expect(applyQuery([1, 2, 3], { count: true })).toBe(3);
    expect(applyQuery('hello', { count: true })).toBe(5);
    expect(applyQuery({ a: 1, b: 2 }, { count: true })).toBe(2);
  });

  it('count composes after path (count the items at a path)', () => {
    expect(applyQuery({ list: [1, 2, 3, 4] }, { path: 'list', count: true })).toBe(4);
  });

  it('filter: keeps array items matching a predicate (with AND/OR)', () => {
    const arr = [{ n: 1, ok: true }, { n: 5, ok: false }, { n: 9, ok: true }];
    expect(applyQuery(arr, { filter: 'n > 1' })).toEqual([{ n: 5, ok: false }, { n: 9, ok: true }]);
    expect(applyQuery(arr, { filter: 'n > 1 AND ok == true' })).toEqual([{ n: 9, ok: true }]);
  });

  it('slice: returns the [start, end) window of an array', () => {
    expect(applyQuery([1, 2, 3, 4, 5], { slice: [1, 3] })).toEqual([2, 3]);
  });

  it('search: keeps array items whose JSON contains the term (case-insensitive)', () => {
    const arr = [{ name: 'Apple' }, { name: 'banana' }, { name: 'cherry' }];
    expect(applyQuery(arr, { search: 'BAN' })).toEqual([{ name: 'banana' }]);
  });

  it('sample: returns n items, or the whole array when n >= length', () => {
    const arr = [1, 2, 3, 4, 5];
    const sampled = applyQuery(arr, { sample: 3 }) as number[];
    expect(sampled).toHaveLength(3);
    for (const v of sampled) expect(arr).toContain(v);
    expect(applyQuery([1, 2], { sample: 10 })).toEqual([1, 2]); // n >= length → all
  });

  it('slice: also returns the [start, end) window of a STRING — the escape hatch a model reaches for after serialize() tells it to "inspect([var, {slice:[0,10]}]) to expand" a truncated document/delegate-result string, not just an array', () => {
    expect(applyQuery('hello world', { slice: [0, 5] })).toBe('hello');
    expect(applyQuery('x'.repeat(5000), { slice: [200, 400] })).toBe('x'.repeat(200));
  });

  it('leaves non-array, non-string values untouched for slice', () => {
    expect(applyQuery(42, { slice: [0, 2] })).toBe(42);
    expect(applyQuery({ a: 1 }, { slice: [0, 2] })).toEqual({ a: 1 });
    expect(applyQuery(null, { slice: [0, 2] })).toBe(null);
  });
});

describe('formatInspectResult', () => {
  it('renders a VARIABLES block keyed by index', () => {
    const out = formatInspectResult([{ value: 42 }, { value: 'hi' }]);
    expect(out.split('\n')[0]).toBe('VARIABLES');
    expect(out).toContain('inspected[0]: 42');
    expect(out).toContain('inspected[1]: "hi"');
  });

  it('includes the queried path in the key when present', () => {
    const out = formatInspectResult([{ value: 7, query: { path: 'a.b' } }]);
    expect(out).toContain('inspected[0].a.b: 7');
  });

  it('does NOT re-apply the standard 200-char preview cap to a big string — inspect() exists precisely to show more than the preview did', () => {
    const big = 'y'.repeat(5000);
    const out = formatInspectResult([{ value: big }]);
    expect(out).not.toContain('chars total'); // under the 20k inspect cap: shown in full, untruncated
    expect(out).toContain(big);
  });

  it('a slice narrowed to a small window is shown in full, not re-truncated by the outer byteCap', () => {
    const big = 'z'.repeat(50_000);
    const sliced = applyQuery(big, { slice: [0, 3000] }) as string;
    const out = formatInspectResult([{ value: sliced, query: { slice: [0, 3000] } }]);
    expect(out).toContain('z'.repeat(3000));
    expect(out).not.toContain('chars total');
  });

  it('still bounds a pathological outlier past the inspect cap, with a total-length marker', () => {
    const huge = 'w'.repeat(30_000);
    const out = formatInspectResult([{ value: huge }]);
    expect(out).toContain('chars total');
  });
});
