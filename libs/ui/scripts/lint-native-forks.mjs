#!/usr/bin/env node
/**
 * lint-native-forks.mjs — the fork ratchet.
 *
 * The invariant this package is built on is **one source, two outputs**: a screen, a store, a hook
 * or a data path has exactly one file, and only the leaf translation differs. A `.native`/`.web`
 * file is therefore legal for exactly three reasons:
 *
 *   - `primitive`  — host-element translation at the primitive/overlay layer (`Box` → `View`).
 *   - `platform`   — a capability seam (`storage`, `clipboard`, `dimensions`).
 *   - `absent`     — the capability genuinely does not exist on the target, and the fork renders
 *                    `UnavailableOnMobile` rather than reimplementing it (Monaco, xterm).
 *
 * A fork that merely re-expresses the same idea in the other platform's vocabulary is how a
 * codebase ends up with two products. This gate does not judge the code — it makes adding a fork a
 * deliberate act: a new one fails until it is listed here with a reason, and a stale entry fails
 * too, so the list cannot drift from the tree.
 *
 * NOTE on a rule that is deliberately NOT here: "no const exported from both siblings". Fork pairs
 * MUST export the same names — that is the whole mechanism (a surface writes `{...DIALOG_BASE}` and
 * Metro hands it the right one). The duplication worth preventing is a duplicated VALUE, and the
 * fix for that is a shared platform-free module (`overlays/dialog/styles.ts`), not a lint that
 * would forbid the mechanism itself.
 *
 * Usage: node libs/ui/scripts/lint-native-forks.mjs
 */
import { readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** Every legal fork, with the reason it is allowed to exist. Adding one is a deliberate act. */
const ALLOWED = {
  // `absent` — a web-only widget with no native implementation; the fork is the honest fallback.
  'computer/ide-editor.native.tsx': 'absent',
  'computer/ide-editor.web.tsx': 'absent',
  'elements/content/terminal/index.native.tsx': 'absent',
  'elements/content/terminal/index.web.tsx': 'absent',

  // `primitive` — host-element translation. These are the whole reason the surfaces can be shared.
  'elements/primitives/box/index.native.tsx': 'primitive',
  'elements/primitives/col/index.native.tsx': 'primitive',
  'elements/primitives/controls.native.tsx': 'primitive',
  'elements/primitives/form/index.native.tsx': 'primitive',
  'elements/primitives/image/index.native.tsx': 'primitive',
  'elements/primitives/link/index.native.tsx': 'primitive',
  'elements/primitives/list/index.native.tsx': 'primitive',
  'elements/primitives/media.native.tsx': 'primitive',
  'elements/primitives/misc.native.tsx': 'primitive',
  'elements/primitives/pressable/index.native.tsx': 'primitive',
  'elements/primitives/row/index.native.tsx': 'primitive',
  'elements/primitives/svg.native.tsx': 'primitive',
  'elements/primitives/table.native.tsx': 'primitive',
  'elements/primitives/text/index.native.tsx': 'primitive',

  // `primitive` — the overlays portal through `react-dom` on web and RN `Modal` on native. The
  // dropdown fork additionally re-anchors with `measureInWindow` because RN has no
  // `position: fixed`; its own header argues that trade-off.
  'elements/overlays/context-menu/index.native.tsx': 'primitive',
  'elements/overlays/dialog/index.native.tsx': 'primitive',
  'elements/overlays/dropdown/index.native.tsx': 'primitive',
  'elements/overlays/sheet/index.native.tsx': 'primitive',

  // `platform` — a browser global with no direct RN equivalent, behind a narrow API.
  'platform/api-base.native.ts': 'platform',
  'platform/clipboard.native.ts': 'platform',
  'platform/dimensions.native.ts': 'platform',
  'platform/storage.native.ts': 'platform',
}

const CATEGORIES = new Set(['primitive', 'platform', 'absent'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(native|web)\.tsx?$/.test(name)) out.push(relative(uiSrc, p))
  }
  return out
}

const found = walk(uiSrc).sort()
const failures = []

for (const file of found) {
  const category = ALLOWED[file]
  if (!category) {
    failures.push(
      `NEW FORK  ${file}\n` +
        `    Not in the allow-list. A fork is legal only as 'primitive' (host-element translation),\n` +
        `    'platform' (a capability seam) or 'absent' (the capability does not exist on the target).\n` +
        `    If it is a screen, store, hook or data path, push the platform difference DOWN into a\n` +
        `    seam instead. If it is genuinely one of the three, add it to ALLOWED with its reason.`,
    )
  } else if (!CATEGORIES.has(category)) {
    failures.push(`BAD CATEGORY  ${file} → ${category}`)
  }
}

for (const file of Object.keys(ALLOWED)) {
  if (!found.includes(file)) {
    failures.push(`STALE ENTRY  ${file} — listed in ALLOWED but no longer on disk; remove it.`)
  }
}

if (failures.length) {
  console.error(`\n${failures.length} fork-ratchet failure(s):\n`)
  for (const f of failures) console.error(`  ${f}\n`)
  process.exit(1)
}

const byCategory = Object.values(ALLOWED).reduce((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {})
console.log(
  `lint-native-forks: clean (${found.length} forks — ` +
    Object.entries(byCategory)
      .map(([c, n]) => `${n} ${c}`)
      .join(', ') +
    ')',
)
