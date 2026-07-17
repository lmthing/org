import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      // The live-scenario harness is plain Node ESM (zero-dep, no build step). It had NO
      // coverage at all, so a transport regression in it only ever surfaced as a dead
      // multi-hour prod run. Its pure units (retry/backoff policy) are node-safe.
      'scenarios/harness/**/*.test.mjs',
      // The scenario library's pure transforms (evidence/scenario/asks) — golden-tested against
      // recorded run output so a byte-compat regression in the judge's evidence is caught here.
      'scenarios/lib/**/*.test.mjs',
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
