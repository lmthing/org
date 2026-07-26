/**
 * config.cjs — the ONE Metro configuration for the shared libs' native target.
 *
 * `apps/mobile/metro.config.js` is the Expo app's config and is deliberately outside the pnpm
 * workspace (see `apps/mobile/README.md`); this one lives INSIDE it, so Metro can bundle
 * `@lmthing/ui` for `ios`/`android` in an ordinary `pnpm install` — no Expo, no simulator, no
 * native toolchain. Metro itself is already in the tree (react-native 0.86 pulls it in), which is
 * what makes a native bundle a normal, CI-runnable check rather than a device-only one.
 *
 * `projectRoot` is the REPO ROOT, not `libs/ui`: the libs import each other by workspace path, so
 * anything narrower makes `@lmthing/css` / `@lmthing/state` unresolvable. Metro's platform
 * extension order (`*.native.tsx` before `*.tsx`) is what selects the primitives' native forks —
 * it is the behaviour under test, so it is never overridden here.
 */
const path = require('node:path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const { createNativeMockResolver } = require('./native-mocks.cjs')

const repoRoot = path.resolve(__dirname, '../../..')

/**
 * Stylesheet specifiers a native resolve has redirected to the empty module, as
 * `<importer> → <specifier>`. A `.css` import means nothing on React Native — Metro cannot resolve
 * one at all, so a single `import './x.css'` in a shared file makes the whole graph unbuildable.
 *
 * Redirecting it keeps the graph resolvable, but a SILENT redirect is the exact failure this
 * harness exists to prevent: the gate would go green while the device rendered unstyled. So every
 * redirect is recorded here and `graph-gate.mjs` fails on any of them that is reachable from
 * `entries/surface.ts` — the drop is allowed to exist, it is not allowed to be invisible.
 */
const redirectedStylesheets = []

/**
 * @param {{mockNativeModules?: boolean, quiet?: boolean}} options
 *   `mockNativeModules` swaps RN's native-backed modules for RN's own jest mocks
 *   (see `native-mocks.cjs`) — required to EXECUTE a bundle off-device, omitted when the point is
 *   to prove the real graph resolves.
 */
function createNativeMetroConfig({ mockNativeModules = false, quiet = true } = {}) {
  const base = getDefaultConfig(repoRoot)
  const mocks = mockNativeModules ? createNativeMockResolver() : null
  const emptyModule = require.resolve('./mocks/empty.js')

  /**
   * `.css` → the empty module (recorded), everything else to the native mocks if they are on, and
   * otherwise to Metro's own resolver. One `resolveRequest` because Metro allows exactly one.
   */
  const resolveRequest = (context, moduleName, platform) => {
    if (moduleName.endsWith('.css')) {
      redirectedStylesheets.push(`${context.originModulePath} → ${moduleName}`)
      return { type: 'sourceFile', filePath: emptyModule }
    }
    if (mocks) return mocks.resolveRequest(context, moduleName, platform)
    return context.resolveRequest(context, moduleName, platform)
  }

  return mergeConfig(base, {
    projectRoot: repoRoot,
    watchFolders: [repoRoot],
    resolver: {
      resolveRequest,
      // RN's preset runs `@babel/plugin-transform-runtime`, so EVERY transformed file may emit an
      // `@babel/runtime/helpers/*` import. Under pnpm's isolated store only `libs/ui` has that
      // package, so the moment the graph reaches a sibling lib (`@lmthing/auth`, pulled in by
      // `chat/app/auth.ts`) the helper is unresolvable from there. A real app has one copy at its
      // root; this maps every package at the one copy in the workspace, which is the same shape.
      extraNodeModules: {
        '@babel/runtime': path.dirname(require.resolve('@babel/runtime/package.json')),
      },
    },
    // RN's transformer plus one rewrite that makes RN's own jest mocks bundleable. Applied on both
    // paths (mocked or not) so the two share one transform cache — the rewrite is scoped to files
    // inside `@react-native/jest-preset`, so it is a no-op for everything else.
    transformer: { babelTransformerPath: require.resolve('./transformer.cjs') },
    // Metro's default reporter prints a logo and a progress bar; in a test runner that is noise
    // around the only two lines that matter (pass/fail). Errors still throw.
    ...(quiet ? { reporter: { update() {} } } : {}),
  })
}

module.exports = { createNativeMetroConfig, repoRoot, redirectedStylesheets }
