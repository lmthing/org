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

## Testing the Yield Protocol

```typescript
import { createVM } from '@repl/core';
import { createAskGlobal } from '../../globals/ask.js';
import { injectGlobal } from '../../sandbox/host-bridge.js';

it('ask() pushes a yield and resolves when deferred resolves', async () => {
  const vm = await createVM();
  const yields: YieldRequest[] = [];
  const pushYield = (r: YieldRequest) => yields.push(r);
  const mockRenderHost = { ask: vi.fn(), display: vi.fn(), log: vi.fn() };

  injectGlobal(vm.ctx, 'ask', createAskGlobal(pushYield, mockRenderHost));

  vm.evalStatement(`const x = ask({ type: 'div', props: {}, children: [] });`);

  expect(yields).toHaveLength(1);
  expect(yields[0]!.kind).toBe('ask');

  yields[0]!.deferred.resolve('hello');
  await Promise.resolve();
  vm.drivePendingJobs();

  expect(vm.getScope()['x']).toBe('hello');
});
```

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
