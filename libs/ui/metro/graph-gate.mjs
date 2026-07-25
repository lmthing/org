/**
 * graph-gate.mjs — the assertions that make a Metro graph a TEST rather than a build.
 *
 * Three things can be wrong with the native module graph, and none of them are visible from web
 * CI or from a `tsc` run:
 *
 *   1. **A fork is not selected.** `Metro prefers *.native.tsx` is the load-bearing assumption of
 *      the whole native target (`elements/primitives/_native.tsx`, `platform/index.ts`). If a fork
 *      is added with a name Metro does not pair with its web sibling — or a barrel re-exports the
 *      web file by its explicit `index.tsx` path — the app silently bundles the DOM implementation
 *      and only fails on a device.
 *   2. **A web-only module leaks in.** `react-dom`, Monaco, xterm and the DOM screenshotter cannot
 *      run on native. The `*.web.tsx` seam exists to keep them out; nothing checked that it did.
 *   3. **The graph does not resolve at all** — a missing fork for an RN-only dependency. That one
 *      is caught by `buildNativeGraph` throwing, before any assertion here runs.
 *
 * Every check is computed from the graph Metro actually produced, so it cannot drift from what
 * Metro would do on a device.
 */
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './config.cjs'

const uiSrc = path.join(repoRoot, 'libs', 'ui', 'src')

/**
 * Modules that must NEVER appear in a native graph, with the reason reported on failure.
 * Matched against the absolute module path.
 */
const WEB_ONLY = [
  ['/node_modules/react-dom/', 'react-dom is the DOM renderer; native renders through react-native'],
  ['/node_modules/react-native-web/', 'react-native-web is the web SHIM — on native it shadows the real RN'],
  ['/node_modules/@monaco-editor/', 'Monaco is a DOM editor (belongs behind a *.web.tsx seam)'],
  ['/node_modules/@xterm/', 'xterm is a DOM terminal (belongs behind a *.web.tsx seam)'],
  ['/node_modules/modern-screenshot/', 'modern-screenshot walks the DOM'],
  ['/node_modules/jsdom/', 'jsdom is a test-only DOM'],
]

/**
 * Forks that MUST be selected by the native graph of `entries/surface.ts`. This list is the
 * ratchet: it starts at what is proven to bundle today and grows as surfaces port. A fork that
 * stops being reachable is a regression, not a cleanup — deleting an entry here is a deliberate act.
 */
export const EXPECTED_NATIVE_FORKS = [
  'src/elements/primitives/box/index.native.tsx',
  'src/elements/primitives/text/index.native.tsx',
  'src/elements/primitives/row/index.native.tsx',
  'src/elements/primitives/col/index.native.tsx',
  'src/elements/primitives/pressable/index.native.tsx',
  'src/elements/primitives/image/index.native.tsx',
  'src/elements/primitives/link/index.native.tsx',
  'src/elements/primitives/list/index.native.tsx',
  'src/elements/primitives/form/index.native.tsx',
  'src/elements/primitives/controls.native.tsx',
  'src/elements/primitives/media.native.tsx',
  'src/elements/primitives/misc.native.tsx',
  'src/elements/primitives/svg.native.tsx',
  'src/elements/primitives/table.native.tsx',
  'src/elements/overlays/dialog/index.native.tsx',
  'src/elements/overlays/sheet/index.native.tsx',
  'src/elements/overlays/context-menu/index.native.tsx',
  'src/elements/overlays/dropdown/index.native.tsx',
  'src/platform/storage.native.ts',
  'src/platform/clipboard.native.ts',
  'src/platform/dimensions.native.ts',
]

/** Every `*.native.ts(x)` under `libs/ui/src`, as repo-relative paths. */
export function findNativeForks(dir = uiSrc, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) findNativeForks(p, out)
    else if (/\.native\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** `foo/index.native.tsx` → `foo/index.tsx` — the web sibling Metro must NOT have picked. */
function webSiblingOf(forkPath) {
  const ext = path.extname(forkPath)
  const candidate = forkPath.replace(/\.native(\.tsx?)$/, '$1')
  if (fs.existsSync(candidate)) return candidate
  // A `.native.tsx` fork of a `.ts` web file (or vice versa) is still a pair to Metro.
  const swapped = candidate.replace(/\.tsx?$/, ext === '.tsx' ? '.ts' : '.tsx')
  return fs.existsSync(swapped) ? swapped : null
}

/**
 * @param {{modules: string[], platform: string, expectForks?: string[]}} input
 * @returns {{failures: {check: string, detail: string}[], forksSelected: string[], moduleCount: number}}
 */
export function checkNativeGraph({ modules, platform, expectForks = EXPECTED_NATIVE_FORKS }) {
  const inGraph = new Set(modules)
  const failures = []
  const rel = (p) => path.relative(path.join(repoRoot, 'libs', 'ui'), p)

  // 1. Fork selection — for every fork pair, native in, web out.
  const forksSelected = []
  for (const fork of findNativeForks()) {
    if (inGraph.has(fork)) forksSelected.push(rel(fork))
    const web = webSiblingOf(fork)
    if (web && inGraph.has(web)) {
      failures.push({
        check: 'fork-selection',
        detail:
          `${rel(web)} is in the ${platform} graph even though ${rel(fork)} exists. Metro must ` +
          `prefer the native fork; a surface importing the web file by its explicit path defeats it.`,
      })
    }
  }

  // 2. The expected forks are actually reached (an entry that stops importing them would make
  //    check 1 vacuously pass).
  const selected = new Set(forksSelected)
  for (const expected of expectForks) {
    if (!selected.has(expected)) {
      failures.push({
        check: 'fork-coverage',
        detail: `${expected} is not in the ${platform} graph — the native entry no longer reaches it.`,
      })
    }
  }

  // 3. Web-only leakage.
  for (const [needle, why] of WEB_ONLY) {
    const hit = modules.find((m) => m.includes(needle))
    if (hit) {
      const pkg = needle.replace('/node_modules/', '').replace(/\/$/, '')
      failures.push({
        check: 'web-only-leak',
        detail: `${pkg} reached the ${platform} graph (${why}). First module: ${hit}`,
      })
    }
  }

  // 4. A `*.web.tsx` file is by definition the web half of a platform seam.
  const webFork = modules.find((m) => m.startsWith(uiSrc) && m.endsWith('.web.tsx'))
  if (webFork) {
    failures.push({
      check: 'web-only-leak',
      detail: `${rel(webFork)} is a *.web.tsx seam file and must never be in the ${platform} graph.`,
    })
  }

  return { failures, forksSelected, moduleCount: modules.length }
}
