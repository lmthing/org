import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/ui/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // `typescript` must stay external: its `sys` object is computed by an eagerly-invoked
  // IIFE at module load (getNodeSystem() calling require('fs')/require('path')/...), and
  // tsup/esbuild replace that require() with a dynamic-require shim that only works if a
  // real CJS `require` exists at runtime — there is none in an ESM bundle, so bundling
  // `typescript` crashes on the very first `import ts from 'typescript'` with
  // "Dynamic require of \"fs\" is not supported". It ships in node_modules regardless
  // (a real dependency here), so keeping it external just skips the broken inlining.
  external: ['typescript'],
});
