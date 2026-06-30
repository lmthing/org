import { describe, it, expect } from 'vitest';
import { createVM, type VM } from './quickjs.js';
import { injectSpaceFunctions } from './inject-functions.js';

/** Eval an expression and dump the result back to the host. */
function evalDump(vm: VM, code: string): unknown {
  const res = vm.ctx.evalCode(code);
  if (res.error) {
    const err = vm.ctx.dump(res.error);
    res.error.dispose();
    throw new Error(`eval error: ${JSON.stringify(err)}`);
  }
  const value = vm.ctx.dump(res.value);
  res.value.dispose();
  return value;
}

describe('injectSpaceFunctions', () => {
  it('binds an anonymous `export default function` under its map key', async () => {
    const vm = await createVM();
    injectSpaceFunctions(
      vm,
      { greet: 'export default function() { return "hi"; }' },
      {},
      () => {},
    );
    expect(evalDump(vm, 'greet()')).toBe('hi');
    vm.dispose();
  });

  it('binds an `export default` arrow expression under its map key', async () => {
    const vm = await createVM();
    injectSpaceFunctions(vm, { dbl: 'export default (n) => n * 2;' }, {}, () => {});
    expect(evalDump(vm, 'dbl(21)')).toBe(42);
    vm.dispose();
  });

  it('binds a named `export function`', async () => {
    const vm = await createVM();
    injectSpaceFunctions(vm, { add: 'export function add(a, b) { return a + b; }' }, {}, () => {});
    expect(evalDump(vm, 'add(2, 3)')).toBe(5);
    vm.dispose();
  });

  it('prefers bundled JS over TS source when present', async () => {
    const vm = await createVM();
    injectSpaceFunctions(
      vm,
      { f: 'export default function() { return "from-source"; }' },
      { f: 'export default function() { return "from-bundle"; }' },
      () => {},
    );
    expect(evalDump(vm, 'f()')).toBe('from-bundle');
    vm.dispose();
  });

  it('calls onWarn (does not throw) on an eval-time error, and still injects the rest', async () => {
    const vm = await createVM();
    const warned: string[] = [];
    injectSpaceFunctions(
      vm,
      {
        // Unterminated expression -> top-level parse error when eval'd.
        broken: 'export const broken = (',
        good: 'export function good() { return 42; }',
      },
      {},
      (name) => warned.push(name),
    );
    expect(warned).toContain('broken');
    expect(evalDump(vm, 'good()')).toBe(42);
    vm.dispose();
  });
});
