import { describe, it, expect } from 'vitest';
import { extractFunctionSignature, buildOverlay } from './overlay.js';
import { runTsc } from './tsc.js';
import { LIBRARY_DTS } from './library-dts.js';

describe('extractFunctionSignature — local interface emission', () => {
  // Mirrors the architect's writeTaskFile.ts: a parameter typed by a LOCAL interface.
  // Before the fix, only `declare function ...(spec: TaskFileSpec)` was emitted and
  // TaskFileSpec was undefined in the ambient context, so `spec` collapsed to `any`
  // and a wrong `output: 'answer'` (string) passed typecheck — only failing at runtime.
  const writeTaskFileSrc = `
interface TaskFileSpec {
  id: string;
  instruction: string;
  output: Record<string, string>;
  goal?: boolean;
}
export function writeTaskFile(
  space: string,
  tasklist: string,
  spec: TaskFileSpec,
): { ok: boolean; path: string; error?: string } {
  return { ok: true, path: '' };
}`;

  it('emits the local interface declaration alongside the function declare', () => {
    const sig = extractFunctionSignature('writeTaskFile', writeTaskFileSrc);
    expect(sig).toContain('interface TaskFileSpec');
    expect(sig).toContain('output: Record<string, string>');
    expect(sig).toContain('declare function writeTaskFile(');
    expect(sig).toContain('spec: TaskFileSpec');
  });

  it('makes a string `output` a TYPECHECK error (was silently allowed before)', () => {
    const overlay = buildOverlay({ writeTaskFile: writeTaskFileSrc }, { view: {}, form: {} });
    const result = runTsc({
      ambientDts: LIBRARY_DTS + '\n' + overlay,
      sessionContext: '',
      // The exact bug from the run logs: output passed as a string, not Record<string,string>.
      statement: `writeTaskFile('s', 'tl', { id: 'a', instruction: 'x', output: 'answer', goal: true });`,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('accepts a correct object `output`', () => {
    const overlay = buildOverlay({ writeTaskFile: writeTaskFileSrc }, { view: {}, form: {} });
    const result = runTsc({
      ambientDts: LIBRARY_DTS + '\n' + overlay,
      sessionContext: '',
      statement: `writeTaskFile('s', 'tl', { id: 'a', instruction: 'x', output: { answer: 'string' }, goal: true });`,
    });
    expect(result.ok).toBe(true);
  });

  it('still works for functions with no local interfaces', () => {
    const src = `export function add(a: number, b: number): number { return a + b; }`;
    const sig = extractFunctionSignature('add', src);
    expect(sig).toBe('declare function add(a: number, b: number): number;');
  });
});
