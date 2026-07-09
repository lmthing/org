import { defineConfig } from 'tsup';

export default defineConfig({
  // Object form pins output basenames. `worker` MUST emit `dist/worker.js` (a
  // self-contained bundle) because the api runtime resolves the worker-thread entry as
  // a SIBLING of its own bundled module (dist/index.js) — tsup flattens src/ into single
  // dist entries, so the worker needs its own entry to exist at that sibling path.
  entry: { index: 'src/index.ts', 'cli/bin': 'src/cli/bin.ts', worker: 'src/app/api/worker.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // `unpdf` (PDF) and `xlsx` (spreadsheets) are lazily-imported document extractors
  // kept external so tsup doesn't inline them; they ship in node_modules.
  external: ['ink', 'react', 'ws', 'esbuild', 'unpdf', 'xlsx'],
});
