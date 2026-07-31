#!/usr/bin/env node
/**
 * generate-tauri-conf.mjs — emit the colours the Rust shell needs, from `tokens.json`.
 *
 * `apps/mobile/app.config.js` is a `.js` file rather than an `app.json` for exactly one reason: so
 * native colours are READ from the design tokens instead of transcribed as hex literals. A window
 * background that has drifted from the token is the same class of bug as a raw colour in a
 * stylesheet — just one no linter looks at, because `lint:tokens` scans `src/`, not packaging
 * config or Rust.
 *
 * Tauri's config is JSON and cannot import anything, and `src-tauri/src/*.rs` must not carry a hex
 * either. So this writes `src-tauri/tokens.generated.json`, which `config.rs` reads with
 * `include_str!`. Hand-editing it is pointless: run `pnpm generate:tauri-conf` (wired into
 * `pretauri:build` / `pretauri:dev`) after any token change.
 *
 * The output IS committed, matching how `libs/css` commits `theme.css` and
 * `tamagui/tokens.generated.ts` — a `include_str!` of a gitignored file makes a fresh clone fail to
 * compile before it fails to run, which is a much worse first five minutes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..')
const tokensPath = join(app, '../../libs/css/src/tokens/tokens.json')
const outPath = join(app, 'src-tauri/tokens.generated.json')

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'))

/** Fail loudly on an unknown token — a silently missing colour is how drift starts. */
function color(name, theme) {
  const token = tokens.colors.find((c) => c.name === name)
  if (!token) throw new Error(`generate-tauri-conf: unknown design token "${name}"`)
  const value = token[theme]
  if (!value) throw new Error(`generate-tauri-conf: token "${name}" has no "${theme}" value`)
  return value
}

/**
 * The window's own background, painted by the OS before the webview renders anything.
 *
 * Both themes, because the window is created before any CSS exists to answer the question and the
 * shell picks by the OS preference. Without it the frame shows the platform default — white
 * everywhere — for the moment between the window appearing and first paint, which on a dark theme
 * is a full-brightness flash on every single launch.
 */
const generated = {
  $generated: 'pnpm generate:tauri-conf — do not edit; source is libs/css/src/tokens/tokens.json',
  backgroundLight: color('background', 'light'),
  backgroundDark: color('background', 'dark'),
}

writeFileSync(outPath, `${JSON.stringify(generated, null, 2)}\n`)
console.log(
  `generate-tauri-conf: wrote ${outPath} (light ${generated.backgroundLight}, dark ${generated.backgroundDark})`,
)
