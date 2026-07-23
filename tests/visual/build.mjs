#!/usr/bin/env node
/**
 * Bundles the visual harness (entry.tsx + fixtures + primitives) into a single static page with
 * esbuild — no Vite/Tailwind needed. Output → tests/visual/dist/{bundle.js,bundle.css,index.html}.
 * The Playwright config serves this dir. Re-run after any primitive change to capture a fresh
 * candidate. See docs/react-native-tamagui-migration.md §3.1.
 */
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outdir = join(here, 'dist')
mkdirSync(outdir, { recursive: true })

await build({
  entryPoints: [join(here, 'harness/entry.tsx')],
  bundle: true,
  outfile: join(outdir, 'bundle.js'),
  format: 'iife',
  jsx: 'automatic',
  // react/react-dom live in libs/ui/node_modules (the harness imports the libs/ui primitives);
  // add it + the hoisted store to the resolution path.
  nodePaths: [join(here, '../../libs/ui/node_modules'), join(here, '../../node_modules')],
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  logLevel: 'info',
})

writeFileSync(
  join(outdir, 'index.html'),
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>lmthing visual harness</title>
    <link rel="stylesheet" href="./bundle.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./bundle.js"></script>
  </body>
</html>
`,
)

console.log('[visual-harness] built → tests/visual/dist')
