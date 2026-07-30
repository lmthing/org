import { describe, it, expect, afterEach } from 'vitest';
import { defaultMemoryLimitBytes } from './quickjs.js';

/**
 * The QuickJS arena size comes from the pod's budget, not from a literal.
 *
 * A QuickJS runtime's memory is an off-heap WASM `ArrayBuffer`. V8 cannot see it, so
 * `--max-old-space-size` does not bound it, so the gateway's V8 cap said nothing about it. The
 * gateway now divides the container limit ONCE — baseline, V8 cap, and
 * `maxConcurrentForks * arena` — and passes the sandbox half down as `LM_VM_MEMORY_MB`
 * (`cloud/gateway/src/lib/compute.ts#memoryBudget`). If this regresses to a hardcoded default that
 * division becomes a fiction and a free pod is OOMKilled mid-turn, which is what happened
 * (.issues/session-lost-when-pod-recycles.md).
 *
 * ## Why this asserts the NUMBER and not the behaviour
 *
 * The obvious test — allocate past the arena and require a refusal — was written first and does not
 * work. `evalScript` answers `{ok: true}` with no `value` even for a plain `b.length`, so its
 * result cannot distinguish "allocated 64MiB" from "died trying"; a 1MiB runtime does refuse, an
 * 8MiB one appears to accept 64MiB. Whether `runtime.setMemoryLimit` bounds string allocation in
 * this asyncified build is therefore UNRESOLVED and recorded as such in the issue.
 *
 * So this pins the half that is ours and is knowable: the env the gateway sets becomes the number
 * handed to the runtime. What that number then enforces is QuickJS's contract, not this module's.
 */
const ORIGINAL = process.env['LM_VM_MEMORY_MB'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['LM_VM_MEMORY_MB'];
  else process.env['LM_VM_MEMORY_MB'] = ORIGINAL;
});

describe('QuickJS arena size', () => {
  it('takes the pod budget from LM_VM_MEMORY_MB', () => {
    process.env['LM_VM_MEMORY_MB'] = '48';
    expect(defaultMemoryLimitBytes()).toBe(48 * 1024 * 1024);
  });

  it('falls back to 64MiB when the pod sets nothing — a local `lmthing` run is unchanged', () => {
    delete process.env['LM_VM_MEMORY_MB'];
    expect(defaultMemoryLimitBytes()).toBe(64 * 1024 * 1024);
  });

  it('ignores a value that is not a usable size rather than trusting it', () => {
    // A malformed env must not become a 0-byte or negative arena, which would fail every eval
    // rather than bounding one.
    for (const bad of ['', 'lots', '0', '-16', 'NaN']) {
      process.env['LM_VM_MEMORY_MB'] = bad;
      expect(defaultMemoryLimitBytes()).toBe(64 * 1024 * 1024);
    }
  });
});
