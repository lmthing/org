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

const orgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Every package whose sources may hold a fork. It stopped being just `libs/ui` when the auth client
 * got a session-store seam: a fork in a package this list does not name is invisible to the ratchet,
 * which is the one failure mode a ratchet cannot have.
 */
const FORK_ROOTS = [join(orgRoot, 'libs', 'ui', 'src'), join(orgRoot, 'libs', 'auth', 'src')]

/** Every legal fork, with the reason it is allowed to exist. Adding one is a deliberate act. */
const ALLOWED = {
  // `absent` — a web-only widget with no native implementation; the fork is the honest fallback.
  'libs/ui/src/computer/ide-editor.native.tsx': 'absent',
  'libs/ui/src/computer/ide-editor.web.tsx': 'absent',
  'libs/ui/src/elements/content/terminal/index.native.tsx': 'absent',
  'libs/ui/src/elements/content/terminal/index.web.tsx': 'absent',

  // `primitive` — host-element translation. These are the whole reason the surfaces can be shared.
  'libs/ui/src/elements/primitives/box/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/col/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/controls.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/form/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/image/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/link/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/list/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/media.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/misc.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/pressable/index.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/row/index.native.tsx': 'primitive',
  // `primitive` — a real `KeyboardAvoidingView` host, because React Native does not move a
  // layout out of the soft keyboard's way: a composer pinned to the bottom stays put and the
  // keyboard is drawn on top of it, so you cannot see what you are typing. Web needs nothing
  // (the browser resizes its own viewport), which is exactly what makes this a fork rather
  // than shared code. iOS and Android also disagree — Android has already resized the window
  // by then — and that difference belongs in the fork, not at every call site.
  'libs/ui/src/elements/primitives/keyboard-avoiding/index.native.tsx': 'primitive',
  // `primitive` — Yoga has no overflow scrolling, so a scrolling region is an RN `ScrollView`
  // host component rather than a `View` with a style. See the fork's own header.
  'libs/ui/src/elements/primitives/scroll/index.native.tsx': 'primitive',
  // `primitive` — the HORIZONTAL twin of the above, for the same Yoga reason. It is a
  // separate file rather than a prop on `primitives/scroll` because that fork routes every
  // unrecognised prop onto its inner content view, so a `horizontal` passed through it
  // would silently scroll the wrong axis. The view renderer's `scroll: 'x'` (a wide table,
  // a week grid) is native CORRECTNESS, not cosmetics: without a real scrolling host the
  // overflow is clipped with no gesture to reach it.
  'libs/ui/src/view/hscroll.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/svg.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/table.native.tsx': 'primitive',
  'libs/ui/src/elements/primitives/text/index.native.tsx': 'primitive',

  // `primitive` — an icon is a host element on both targets and the SAME element on neither:
  // `lucide-react` emits a DOM `<svg>`, which React Native has no host component for, and
  // `react-native-svg` drags React Native into a web bundle. Both directions are real, so the icon
  // set is drawn once per host rather than once per icon.
  'libs/ui/src/elements/primitives/icons/index.native.tsx': 'primitive',

  // `primitive` — "show a page from the pod inside the surface" is an `<iframe>` on web and a
  // `react-native-webview` on native. Same prop shape, same meaning, different host element; the
  // WebView is provided by the APP, never by this package.
  'libs/ui/src/elements/content/app-view/view.native.tsx': 'primitive',

  // `primitive` — the overlays portal through `react-dom` on web and RN `Modal` on native. The
  // dropdown fork additionally re-anchors with `measureInWindow` because RN has no
  // `position: fixed`; its own header argues that trade-off.
  'libs/ui/src/elements/overlays/context-menu/index.native.tsx': 'primitive',
  'libs/ui/src/elements/overlays/dialog/index.native.tsx': 'primitive',
  'libs/ui/src/elements/overlays/dropdown/index.native.tsx': 'primitive',
  'libs/ui/src/elements/overlays/sheet/index.native.tsx': 'primitive',

  // `platform` — a browser global with no direct RN equivalent, behind a narrow API.
  'libs/ui/src/platform/api-base.native.ts': 'platform',
    // `platform` — a capability seam. A laptop has no haptic engine, so web is all no-ops;
  // native is `expo-haptics`, lazily imported so a build that does not link it still boots.
  // It exists because the dependency runs one way: a shared surface owns the send button and
  // the long-press, and `apps/mobile` cannot reach back into `libs/ui` to wire feedback onto
  // controls it does not own — which is why those interactions were silent on a device.
  'libs/ui/src/platform/haptics.native.ts': 'platform',
'libs/ui/src/platform/clipboard.native.ts': 'platform',
  'libs/ui/src/platform/deep-link.native.ts': 'platform',
  'libs/ui/src/platform/keyboard.native.ts': 'platform',
  'libs/ui/src/platform/navigation.native.ts': 'platform',
  'libs/ui/src/platform/dimensions.native.ts': 'platform',
  'libs/ui/src/platform/storage.native.ts': 'platform',

  // `platform` — the auth session is a BEARER token, so native persists it in the OS keystore
  // rather than the plaintext store the other seams use, and bridges that async API to the
  // synchronous `getSession()` every request already depends on.
  'libs/auth/src/platform/session-store.native.ts': 'platform',

  // `platform` — React Native ships no `crypto` global (Expo does not polyfill one), and login is
  // an in-app browser session rather than a page redirect. Both are capability seams; everything
  // after the code comes back is shared in `sso-exchange.ts`.
  'libs/auth/src/platform/crypto.native.ts': 'platform',
  'libs/auth/src/platform/sso.native.ts': 'platform',
}

const CATEGORIES = new Set(['primitive', 'platform', 'absent'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(native|web)\.tsx?$/.test(name)) out.push(relative(orgRoot, p))
  }
  return out
}

const found = FORK_ROOTS.flatMap((root) => walk(root)).sort()
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
