#!/usr/bin/env node
/**
 * sync-fonts.mjs — copy the self-hosted font files into every surface's `public/fonts/`.
 *
 * `fonts.css` (imported by the generated `theme.css`) declares the wordmark face at the absolute
 * URL `/fonts/cera-round-pro-bold.otf`. An absolute URL resolves against the ORIGIN, so each app has
 * to serve its own copy — Vite does that for anything under `public/`.
 *
 * This exists because the previous arrangement was per-app `@font-face` blocks, and only `com` and
 * `apps/web` ever had one. On `org`, `store`, `space`, `blog`, `casa` and `social` the wordmark
 * silently rendered in `system-ui`. Nothing failed, no test noticed, and the logo was simply a
 * different typeface on six of eight surfaces. Copying from one source removes the chance to forget.
 *
 * Run: node scripts/sync-fonts.mjs   (wired into @lmthing/css's `generate` + `prebuild`)
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssRoot = join(__dirname, '..');
const repoRoot = join(cssRoot, '../../../..'); // libs/css -> sdk/org/libs -> sdk/org -> sdk -> repo

// Must stay in step with the @font-face URLs in src/fonts.css.
const FONTS = [
  'Manrope-Regular.ttf',
  'Manrope-Medium.ttf',
  'Manrope-SemiBold.ttf',
  'Manrope-Bold.ttf',
  'Manrope-ExtraBold.ttf',
  'JetBrainsMono-Regular.ttf',
  'JetBrainsMono-Medium.ttf',
  'cera-round-pro-bold.otf',
].map((name) => ({ src: join(cssRoot, 'assets/fonts', name), name }));

// Every surface that imports @lmthing/css/theme.css and is served over HTTP.
const TARGETS = [
  'com', 'org', 'store', 'space', 'blog', 'casa', 'social',
  'sdk/org/apps/web', 'sdk/org/apps/desktop',
].map((p) => join(repoRoot, p));

let copied = 0;
let skipped = 0;
for (const font of FONTS) {
  if (!existsSync(font.src)) {
    console.error(`[sync-fonts] MISSING SOURCE ${font.src} — the wordmark will fall back to system-ui everywhere.`);
    process.exit(1);
  }
  for (const app of TARGETS) {
    if (!existsSync(app)) { skipped++; continue; } // a surface that is not checked out (submodule)
    const dest = join(app, 'public/fonts', font.name);
    if (existsSync(dest) && statSync(dest).size === statSync(font.src).size) continue;
    mkdirSync(join(app, 'public/fonts'), { recursive: true });
    copyFileSync(font.src, dest);
    copied++;
  }
}
console.log(`[sync-fonts] ${copied} file(s) copied into ${TARGETS.length - skipped} surface(s)`);
