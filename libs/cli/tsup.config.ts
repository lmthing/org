import { defineConfig } from 'tsup';

export default defineConfig({
  // Object form pins output basenames. `worker` MUST emit `dist/worker.js` (a
  // self-contained bundle) because the api runtime resolves the worker-thread entry as
  // a SIBLING of its own bundled module (dist/index.js) — tsup flattens src/ into single
  // dist entries, so the worker needs its own entry to exist at that sibling path.
  // `worker-load-entry` is the SAME contract for the emitter/space-hook worker: worker-load.ts
  // resolves `worker-load-entry.js` as a sibling of its own (bundled) module, so it must exist
  // in dist too — otherwise every emitter/space-hook worker invocation fails in prod with
  // "Could not resolve .../dist/worker-load-entry.js" (unit tests run from src/ and miss it).
  entry: {
    index: 'src/index.ts',
    'cli/bin': 'src/cli/bin.ts',
    worker: 'src/app/api/worker.ts',
    'worker-load-entry': 'src/app/worker-load-entry.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // `unpdf` (PDF), `xlsx` (spreadsheets) and `officeparser` (docx/pptx/odt/odp) are
  // lazily-imported document extractors kept external so tsup doesn't inline them;
  // they ship in node_modules.
  external: ['ink', 'react', 'ws', 'esbuild', 'unpdf', 'xlsx', 'officeparser'],
});
