/**
 * harness.ts — the test API that runs INSIDE the Metro bundle.
 *
 * The suites cannot use vitest: they execute in a Metro bundle on the React Native target, where
 * the only thing outside the bundle is a Node process with `console`. So the harness is a ~100-line
 * `test`/`expect` that reports results as tagged NDJSON on stdout, which `run.mjs` parses back into
 * pass/fail. Keeping it this small is deliberate — a bigger harness would need its own tests.
 *
 * The matchers are the ones the suites actually use; add one when a suite needs it, not before.
 */

/** stdout markers. Prefixed so ordinary `console.log` from a component can never be mistaken for one. */
export const RESULT_TAG = '##METRO-TEST-RESULT##'
export const DONE_TAG = '##METRO-TEST-DONE##'

type Case = { name: string; fn: () => unknown | Promise<unknown> }

const cases: Case[] = []

/** Register a case. Suites are plain modules; importing one registers its cases. */
export function test(name: string, fn: () => unknown | Promise<unknown>): void {
  cases.push({ name, fn })
}

function stringify(value: unknown): string {
  try {
    return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as never)[k], (b as never)[k]))
}

/** `{a: 1, b: 2}` matches `{a: 1}` — subset matching, recursive. Used for RN style/prop bags. */
function matchesSubset(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== 'object' || expected === null) return deepEqual(actual, expected)
  if (typeof actual !== 'object' || actual === null) return false
  return Object.keys(expected as object).every((k) =>
    matchesSubset((actual as never)[k], (expected as never)[k]),
  )
}

export function expect(actual: unknown) {
  const fail = (message: string): never => {
    throw new Error(message)
  }
  return {
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) fail(`expected ${stringify(expected)}, got ${stringify(actual)}`)
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected))
        fail(`expected ${stringify(expected)}, got ${stringify(actual)}`)
    },
    toMatchObject(expected: unknown) {
      if (!matchesSubset(actual, expected))
        fail(`expected ${stringify(actual)} to match ${stringify(expected)}`)
    },
    toBeTruthy() {
      if (!actual) fail(`expected a truthy value, got ${stringify(actual)}`)
    },
    toBeNull() {
      if (actual !== null) fail(`expected null, got ${stringify(actual)}`)
    },
    toBeDefined() {
      if (actual === undefined) fail('expected a defined value, got undefined')
    },
    toContain(needle: unknown) {
      const ok = Array.isArray(actual)
        ? actual.includes(needle)
        : typeof actual === 'string' && typeof needle === 'string' && actual.includes(needle)
      if (!ok) fail(`expected ${stringify(actual)} to contain ${stringify(needle)}`)
    },
    toHaveLength(n: number) {
      const len = (actual as { length?: number } | null)?.length
      if (len !== n) fail(`expected length ${n}, got ${stringify(len)}`)
    },
  }
}

/**
 * Run every registered case in order and report. Cases run sequentially on purpose: they share one
 * React renderer and one set of RN mocks, and interleaving them would make a failure unattributable.
 */
export async function runRegisteredCases(): Promise<void> {
  let failed = 0
  for (const { name, fn } of cases) {
    try {
      await fn()
      console.log(`${RESULT_TAG} ${JSON.stringify({ name, ok: true })}`)
    } catch (error) {
      failed++
      const err = error as Error
      console.log(
        `${RESULT_TAG} ${JSON.stringify({
          name,
          ok: false,
          error: err?.message ?? String(error),
          stack: err?.stack ?? null,
        })}`,
      )
    }
  }
  console.log(`${DONE_TAG} ${JSON.stringify({ total: cases.length, failed })}`)
}
