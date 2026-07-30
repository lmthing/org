import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The workspace aliases `apps/web` builds with, mirrored here.
  //
  // Without them the two `apps/web` suites matched below could not even LOAD: `gates.test.ts` imports
  // `gates.tsx`, which imports `@lmthing/ui/components/auth/login-screen` and `@/lib/config`. Neither
  // resolves under a bare node runner — `@/` is an app alias with no meaning outside Vite, and
  // `@lmthing/ui`'s `exports` maps `./components/*` to `.../index.ts` while that component is an
  // `index.tsx`, so package resolution misses it. The app build never noticed because it aliases
  // `@lmthing/ui` straight to source, which bypasses the `exports` map entirely.
  //
  // Mirroring the app's aliases is the right fix rather than excluding the suites: they test genuinely
  // node-safe logic (`waitForPodEdge`'s retry loop against a stubbed `fetch`), and the reason they
  // failed was resolution, not environment. Order matters — specific subpaths BEFORE the generic
  // prefix, exactly as `libs/utils/src/vite.mjs` does it.
  resolve: {
    alias: {
      '@lmthing/ui/chat/css': path.resolve(__dirname, 'libs/ui/src/chat/app/styles.css'),
      '@lmthing/ui': path.resolve(__dirname, 'libs/ui/src'),
      '@lmthing/css/tamagui-tokens': path.resolve(__dirname, 'libs/css/src/tamagui/tokens.generated.ts'),
      '@lmthing/css': path.resolve(__dirname, 'libs/css/src'),
      '@lmthing/state': path.resolve(__dirname, 'libs/state/src'),
      '@lmthing/auth': path.resolve(__dirname, 'libs/auth/src'),
      '@lmthing/core/ui': path.resolve(__dirname, 'libs/core/src/ui/index.ts'),
      // `@/` is `apps/web`'s own alias. `libs/state` and `libs/ui` also use `@/` internally, but both
      // are EXCLUDED from this runner (see `exclude` below), so the only files resolved through it here
      // are `apps/web`'s.
      '@': path.resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'packages/*/apps/*/src/**/*.test.ts',
      'packages/*/apps/*/src/**/*.test.tsx',
      'libs/*/src/**/*.test.ts',
      'libs/*/src/**/*.test.tsx',
      // apps/web has a handful of pure (node-safe) unit tests — origin
      // resolution, host→surface routing. DOM/component tests live in libs/ui;
      // keep only node-safe suites matched here.
      'apps/web/src/**/*.test.ts',
      // apps/mobile is an Expo shell excluded from the workspace, so nothing here can
      // import React Native — but the one decision it genuinely owns, whether a project
      // renders natively or in a WebView, is pure fetch logic over the pod's spec route.
      // That is the whole point of the viewbuilder pipeline, so it gets a node-safe suite
      // rather than resting on `pnpm test:native`, which proves resolution, not policy.
      'apps/mobile/src/**/*.test.ts',
      // The live-scenario harness is plain Node ESM (zero-dep, no build step). It had NO
      // coverage at all, so a transport regression in it only ever surfaced as a dead
      // multi-hour prod run. Its pure units (retry/backoff policy) are node-safe.
      'scenarios/harness/**/*.test.mjs',
      // The scenario library's pure transforms (evidence/scenario/asks) — golden-tested against
      // recorded run output so a byte-compat regression in the judge's evidence is caught here.
      'scenarios/lib/**/*.test.mjs',
      // The ratchet-metrics dashboard (scenarios/metrics/) — pure functions over a run's on-disk
      // artifacts (bricking/vocabulary-gap/retries-per-write/etc.). Node-safe, zero-dep, same
      // rationale as the two entries above.
      'scenarios/metrics/**/*.test.mjs',
    ],
    // libs/state has its OWN vitest config (jsdom + React transforms), so it is
    // excluded here and run by its own `test` script.
    // libs/ui is excluded because its DOM/component suites need jsdom + React
    // transforms this node runner does not provide — but note it has NO vitest
    // config and NO `test` script of its own, so its test files currently run
    // NOWHERE. Giving libs/ui a jsdom config + test script would fix that.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'libs/state/**',
      'libs/ui/**',
    ],
    environment: 'node',
    // Many suites spin up real QuickJS VMs (forks/delegates/solve) and a few spawn
    // the built CLI as a subprocess (keyless-cli, web-api). Under parallel load these
    // exceed the 5s default, so raise the per-test ceiling. Explicit per-test timeouts
    // (e.g. the 60s CLI suites) still override this.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
