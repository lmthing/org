# Skill: Writing Tests

Tests are co-located with source files: `packages/core/src/**/*.test.ts`. Run with `pnpm test`.

## Test Setup

```typescript
import { describe, it, expect, vi } from 'vitest';
```

No global setup file. Each test file is self-contained.

## Existing Test Patterns

### BoundaryDetector (`boundary.test.ts`)
Tests that the streaming statement splitter correctly identifies complete TypeScript statements vs. incomplete fragments. Pattern: call `detector.feed(chunk)` and assert the returned statements array.

### Serializer (`serialize.test.ts`)
Tests truncation at various sizes, array sampling, depth limits, and each `inspect` query operator (`path`, `slice`, `keys`, `count`, `search`, `filter`). Pattern: call `serialize(value)` and assert the output string.

### Condition DSL (`condition-dsl.test.ts`)
Tests boolean expression evaluation against task output maps. Pattern: call `evaluateCondition(expr, outputs)` and assert `true`/`false`.

### TSC Runner (`tsc.test.ts`)
Tests that the incremental typechecker catches errors and passes valid code. Pattern: call `runTsc({ ambientDts, sessionContext, statement })` and assert `result.ok`.

### Host tools / system spaces / fork roles
`globals/host-tools.test.ts` (file I/O round-trip, binary refusal, read-only profile), `spaces/system.test.ts` (loader/merge precedence), `spaces/system-functions.test.ts` (memory/todo through host primitives), `fork/roles.test.ts` (read-only enforcement via a real fork), `eval/turn-loop-yield.test.ts` (parallel/destructured yield binding), `context/summarize.test.ts` (history digest).

## Testing the Yield Protocol

A yielding global pushes a `YieldRequest`; assert its `kind`/`args` and that resolving the deferred settles the VM promise:

```typescript
import { createVM } from '@repl/core';
import { createAskGlobal } from '../../globals/ask.js';
import { injectGlobal } from '../../sandbox/host-bridge.js';

it('ask() pushes a yield', async () => {
  const vm = await createVM();
  const yields: YieldRequest[] = [];
  injectGlobal(vm.ctx, 'ask', createAskGlobal((r) => yields.push(r), { ask: vi.fn(), display: vi.fn(), log: vi.fn() }));
  vm.evalStatement(`const x = ask({ type: 'div', props: {}, children: [] });`);
  expect(yields).toHaveLength(1);
  expect(yields[0]!.kind).toBe('ask');
});
```

**Do NOT assert that `drivePendingJobs()` binds the variable into scope** — the QuickJS post-`await` continuation does not re-run in this sync model. Variable binding from a resolved yield is the **turn loop's** job (`extractBindingPattern` + `vm.setVar`). To test binding end-to-end (incl. `Promise.all` of multiple yields and object destructuring), drive `runTurnLoop` with a scripted stream and assert the emitted VARIABLES block / VM globals — see `eval/turn-loop-yield.test.ts`.

## Testing host primitives (`host-tools.ts`)

Inject into a bare VM, `evalCode` a call, and dump the returned object:

```typescript
import { createVM } from '../sandbox/quickjs.js';
import { injectHostTools } from '../globals/host-tools.js';

const vm = await createVM();
injectHostTools(vm, { renderHost: silentHost, spaceDir: tmpDir });
const res = vm.ctx.evalCode(`readFileRaw(${JSON.stringify(path)})`);
const value = vm.ctx.dump(res.value); res.value.dispose();
expect(value).toMatchObject({ ok: true });
```

Pass `profile: { allowWrite: false }` to assert read-only enforcement (e.g. `writeFileRaw` returns `{ ok: false }`). See `globals/host-tools.test.ts`.

## Testing system spaces & their functions

```typescript
import { loadSystemSpaces, mergeSystemInto } from './system.js';
const [fs] = await loadSystemSpaces([FS_DIR]);          // function-only space, no agents/
expect(Object.keys(fs.functions)).toContain('readFile');
```

To exercise a system function's behavior, inject it like `Session` does (transpile + `evalScript`) over a VM with `injectHostTools`, then `evalCode` calls — see `spaces/system-functions.test.ts` (memory/todo round-trips). Read-only fork enforcement: `fork/roles.test.ts`.

## Testing Space Loading

```typescript
import { loadSpace } from '@repl/core';
import { join } from 'node:path';

it('loads cooking fixture space', async () => {
  const space = await loadSpace(join(process.cwd(), 'fixtures/cooking'));
  expect(space.agents['chef']).toBeDefined();
  expect(space.agents['chef']!.config.functions).toContain('addIngredient');
});
```

## Mock Clock for sleep()

```typescript
import type { Clock } from '@repl/core';

function createMockClock() {
  const pending: Array<{ fn: () => void; at: number }> = [];
  let now = 0;
  const clock: Clock = {
    setTimeout: (fn, ms) => {
      pending.push({ fn, at: now + ms });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
  };
  const advance = (ms: number) => {
    now += ms;
    for (const p of pending.splice(0).filter((p) => p.at <= now)) p.fn();
  };
  return { clock, advance };
}
```

Pass `clock` to `SessionOpts` or `createSleepGlobal` to control time in tests.

## Snapshot / Integration Tests

For full session tests, use a `MockStreamFn` that returns a fixed list of statements:

```typescript
const mockStreamFn = (stmts: string[]): StreamFn => async () => {
  let i = 0;
  return {
    textStream: (async function* () {
      for (const s of stmts) yield s + '\n';
    })(),
    abort: () => {},
  };
};
```

Then run `new Session(opts, { streamFn }).start(message)` and assert on render host calls.

### Reusable mock provider (`@repl/core` `testing/`)

Prefer the shipped builders over a hand-rolled `mockStreamFn` — they are multi-turn,
fork/delegate-aware, and honor `abort()`:

```typescript
import { mockScript, mockMatch, createMockStreamFn } from '@repl/core';

// Sequential queue — turn N emits turns[N]; '' ends the loop.
const streamFn = mockScript(['display("a");', 'display("b");']);

// First-matching-rule-wins — route forks vs. the orchestrator. A fork's prompt
// instructs it to call currentTask.resolve(...) — a reliable fork-only marker.
const streamFn2 = mockMatch(
  [{ when: /currentTask/, respond: () => 'currentTask.resolve({ ok: true });' }],
  () => 'const r = await solve({ /* ... */ });', // fallback = the session/orchestrator
);
```

The same builders drive the CLI via `--mock <file>` (a `.mjs` whose default export is a
`MockHandler` or `string[]`), so a full keyless run is just
`bin.js --space … --mock fixtures/<space>/mock.mjs`. See
`packages/core/src/testing/mock-provider.ts` and `scripts/live-test.sh`.
