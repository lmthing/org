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
    ],
    // libs/state and libs/ui have their own vitest configs (jsdom + React
    // transforms); exclude them from the root node runner to avoid conflicts.
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
