#!/usr/bin/env node
/**
 * cli.mjs — `pnpm --filter @lmthing/ui test:native`.
 *
 * Two checks per platform, in dependency order:
 *
 *   1. **Resolution gate** — Metro resolves and transforms the whole native graph of the shared
 *      surface (`entries/surface.ts`), and `graph-gate.mjs` asserts the right forks were selected
 *      and no web-only module leaked in. This runs FIRST because a graph that does not resolve
 *      makes every render below meaningless.
 *   2. **Render suites** — the bundle in `entries/tests.ts` is built with RN's native modules
 *      mocked, executed in a child Node process, and its per-case results reported here.
 *
 * Both platforms are run: `ios` and `android` resolve DIFFERENT files (`*.ios.js` before
 * `*.native.js`) and mount different native views, so a green `ios` is not evidence about Android.
 * Pass `--platform ios` to narrow it while iterating.
 *
 * Exit code is 1 if anything failed, which is what makes this usable as a CI gate.
 */
import { buildNativeGraph, buildNativeBundle, NATIVE_PLATFORMS } from './build.mjs'
import { checkNativeGraph } from './graph-gate.mjs'
import { runNativeBundle } from './run.mjs'

const args = process.argv.slice(2)
const platformArg = args.indexOf('--platform')
const platforms = platformArg === -1 ? NATIVE_PLATFORMS : [args[platformArg + 1]]
const only = args.includes('--gate') ? 'gate' : args.includes('--suites') ? 'suites' : 'all'

let failures = 0

for (const platform of platforms) {
  if (only !== 'suites') {
    process.stdout.write(`[metro:${platform}] resolving the native graph…\n`)
    const { modules } = await buildNativeGraph({ entry: 'entries/surface.ts', platform })
    const { failures: gateFailures, forksSelected, moduleCount } = checkNativeGraph({
      modules,
      platform,
    })
    for (const failure of gateFailures) {
      failures++
      process.stdout.write(`  FAIL [${failure.check}] ${failure.detail}\n`)
    }
    if (gateFailures.length === 0) {
      process.stdout.write(
        `  ok   ${moduleCount} modules, ${forksSelected.length} native forks selected, no web-only leaks\n`,
      )
    }
  }

  if (only !== 'gate') {
    process.stdout.write(`[metro:${platform}] building + running the render suites…\n`)
    const { bundlePath } = await buildNativeBundle({ entry: 'entries/tests.ts', platform })
    const { results, done, exitCode, output } = await runNativeBundle(bundlePath)
    for (const result of results) {
      if (result.ok) process.stdout.write(`  ok   ${result.name}\n`)
      else {
        failures++
        process.stdout.write(`  FAIL ${result.name}\n         ${result.error}\n`)
      }
    }
    if (!done) {
      failures++
      process.stdout.write(
        `  FAIL the bundle did not report a result (exit ${exitCode}). Output:\n${output}\n`,
      )
    }
  }
}

process.stdout.write(failures === 0 ? '\nmetro native harness: PASS\n' : `\nmetro native harness: ${failures} FAILURE(S)\n`)
process.exit(failures === 0 ? 0 : 1)
