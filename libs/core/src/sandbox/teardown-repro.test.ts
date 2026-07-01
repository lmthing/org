import { describe, it, expect } from 'vitest';
import { createVM } from './quickjs.js';

/**
 * VM teardown must not throw even when a stray GC object survives — QuickJS's
 * `list_empty(&rt->gc_obj_list)` assertion fires as a CATCHABLE cleanup failure that
 * does NOT poison the (shared) WASM module. A throw here would corrupt an already-
 * produced fork/delegate result (see fork.ts), so `dispose()` must swallow it.
 */
describe('VM dispose() robustness', () => {
  it('does not throw when a stray runtime object survives teardown', async () => {
    const vm = await createVM();
    // Leak an object into the runtime (never disposed) — the exact `list_empty` trigger.
    vm.ctx.newObject();
    expect(() => vm.dispose()).not.toThrow();
  });

  it('the shared WASM module is still usable after a stray-object teardown', async () => {
    const bad = await createVM();
    bad.ctx.newObject();
    bad.dispose(); // swallows the assertion
    const fresh = await createVM();
    try {
      expect(fresh.evalStatement('globalThis["ok"] = 40 + 2;').ok).toBe(true);
    } finally {
      fresh.dispose();
    }
  });
});
