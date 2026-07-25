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
 * @param {{mockNativeModules?: boolean, quiet?: boolean}} options
 *   `mockNativeModules` swaps RN's native-backed modules for RN's own jest mocks
 *   (see `native-mocks.cjs`) — required to EXECUTE a bundle off-device, omitted when the point is
 *   to prove the real graph resolves.
 */
function createNativeMetroConfig({ mockNativeModules = false, quiet = true } = {}) {
  const base = getDefaultConfig(repoRoot)
  const mocks = mockNativeModules ? createNativeMockResolver() : null
  return mergeConfig(base, {
    projectRoot: repoRoot,
    watchFolders: [repoRoot],
    resolver: mocks ? { resolveRequest: mocks.resolveRequest } : {},
    // RN's transformer plus one rewrite that makes RN's own jest mocks bundleable. Applied on both
    // paths (mocked or not) so the two share one transform cache — the rewrite is scoped to files
    // inside `@react-native/jest-preset`, so it is a no-op for everything else.
    transformer: { babelTransformerPath: require.resolve('./transformer.cjs') },
    // Metro's default reporter prints a logo and a progress bar; in a test runner that is noise
    // around the only two lines that matter (pass/fail). Errors still throw.
    ...(quiet ? { reporter: { update() {} } } : {}),
  })
}

module.exports = { createNativeMetroConfig, repoRoot }
