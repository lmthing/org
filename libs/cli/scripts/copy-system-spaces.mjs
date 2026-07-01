#!/usr/bin/env node
/**
 * copy-system-spaces.mjs — makes the built cli self-contained.
 *
 * tsup bundles @lmthing/core into dist/cli/bin.js, so at runtime
 * defaultSystemSpaceDirs() (libs/core/src/spaces/system.ts) resolves paths
 * relative to the CLI BUNDLE, not the core package: dist/cli/bin.js's
 * __dirname is dist/cli/, and the dist-layout candidate is
 * resolve(__dirname, '..', 'system-spaces') = dist/system-spaces.
 *
 * Copy the real assets (libs/core/system-spaces/) there so a plain
 * `pnpm build` produces a working `node dist/cli/bin.js` outside Docker —
 * previously only the compute Docker image did this copy manually.
 *
 * Run: appended to the cli's `build` script (see package.json).
 */
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const src = join(__dirname, '..', '..', 'core', 'system-spaces');
const dest = join(__dirname, '..', 'dist', 'system-spaces');

if (!existsSync(src)) {
  console.error(`[copy-system-spaces] source not found: ${src}`);
  process.exit(1);
}

cpSync(src, dest, { recursive: true });

console.log(`[copy-system-spaces] copied ${src} -> ${dest}`);
