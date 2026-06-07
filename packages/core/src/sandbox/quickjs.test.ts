import { describe, it, expect } from 'vitest';
import { createVM } from './quickjs.js';

/**
 * evalStatement error surfacing. A top-level `await` makes the statement's module
 * body async, so a throw inside it (e.g. calling a global that wasn't injected)
 * rejects the module's evaluation promise rather than the eval call. That rejection
 * is an unhandled job that executePendingJobs swallows — evalStatement inspects the
 * module promise and reports the rejection so the turn loop sees a real error.
 */
describe('VM evalStatement — error surfacing', () => {
  it('surfaces a throw from a top-level awaited missing global (not silently ok)', async () => {
    const vm = await createVM();
    try {
      const r = vm.evalStatement('const x = await missingGlobal();');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/missingGlobal|not a function/i);
    } finally {
      vm.dispose();
    }
  });

  it('surfaces a throw from inside a top-level await expression', async () => {
    const vm = await createVM();
    try {
      // The awaited promise rejects — must not be swallowed.
      const r = vm.evalStatement('const x = await Promise.reject(new Error("boom"));');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/boom/);
    } finally {
      vm.dispose();
    }
  });

  it('still surfaces a synchronous throw (no await)', async () => {
    const vm = await createVM();
    try {
      const r = vm.evalStatement('alsoMissing();');
      expect(r.ok).toBe(false);
    } finally {
      vm.dispose();
    }
  });

  it('a successful awaited statement returns ok and propagates the binding', async () => {
    const vm = await createVM();
    try {
      const ok = vm.evalStatement('const n = await Promise.resolve(41) + 1;\nglobalThis["n"] = n;');
      expect(ok.ok).toBe(true);
      // The binding survived into VM scope (next module can read it as a global).
      const read = vm.evalStatement('globalThis["doubled"] = globalThis["n"] * 2;');
      expect(read.ok).toBe(true);
    } finally {
      vm.dispose();
    }
  });

  it('a plain non-await statement still evaluates ok', async () => {
    const vm = await createVM();
    try {
      const r = vm.evalStatement('const a = 1 + 1;\nglobalThis["a"] = a;');
      expect(r.ok).toBe(true);
    } finally {
      vm.dispose();
    }
  });
});
