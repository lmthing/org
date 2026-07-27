# Mobile native chat — handoff

**Read this first, then [`mobile-native-chat.md`](./mobile-native-chat.md)** (the plan + a dated
progress log with the reasoning behind every decision). This file is the operational summary: where
the work stands, what is left, how to verify, and the traps that already cost time.

Branch `main`, everything below is **pushed**. Last commit of this work: `eb5f8c2`.

---

## The governing invariant

**One source, two outputs.** A `.native` / `.web` file is legal for exactly three reasons:

| category | meaning |
|---|---|
| `primitive` | host-element translation (`Box` → `View`) |
| `platform` | a capability seam (`storage`, `keyboard`, `api-base`, …) |
| `absent` | the capability does not exist on the target (Monaco, xterm) |

**Never** a screen, store, hook or data path. If a screen needs to differ, the difference belongs in
a seam underneath it. This is enforced by `lint-native-forks.mjs`, not by convention — a new fork
fails the build until it is listed with a reason.

`studio/` is **not** in this plan but **is** intended for the app later (user decision, 2026-07-26).
The seams are written surface-agnostic for that reason; `lint-relative-transport.mjs` and
`lint-dom-globals.mjs` each have a `NATIVE_BOUND` list that studio joins in one line.

---

## What is done (steps 0–7)

| | commit |
|---|---|
| Metro harness + CI gate, self-imports → relative, `SettingsSchemaForm` moved out of `studio/` | earlier session |
| Markdown renders as ELEMENTS (`marked.lexer` → primitives), both stylesheets deleted | `6dcba20` |
| `apps/mobile` regenerated on React 19, **inside** the pnpm workspace | `7b1622e` |
| Lists render on a device (the bug only the emulator could show) | `a99734f` |
| **Transport seam** — `platform/api-base`, 15 call sites, `chat/app/api.ts` | `dec0b0c` |
| esbuild file-form `@lmthing/ui` import regression fixed | `d304871` |
| **Session on native** — `libs/auth/src/platform/session-store` (OS keystore) | `c2afd1f` |
| **Login on native** — `platform/sso` + `platform/crypto`, no caller changed | `62b1b8f` |
| **Deep links + `__LM_SEND__` retired** (see history note below) | `393a5ea` + `e88a57a` |
| **All of `chat/` on the native graph** + `lint-dom-globals.mjs` | `eb5f8c2` |

The app **runs on an Android emulator** and renders the shared markdown surface (screenshot verified
2026-07-26). Emulator: `Small_Phone_API_33`, wiped once to fix a corrupt package DB.

---

## What is left

### Step 8 — animation (not started)

`lm-fade-in`, `lm-pulse`, `animate-pulse` are CSS class hooks, inert on native.
`@tamagui/animations-react-native` is already a dependency and the shared animation names exist.
Convert to `transition` props.

**Two traps already paid for elsewhere in this repo:** the prop is `transition`, **not** `animation`
(Tamagui 2.5 renamed it and silently ignores the old name), and `animateOnly` entries must be
hyphenated CSS names.

Find them with `grep -rn "lm-fade-in\|lm-pulse\|animate-pulse" libs/ui/src`.

**This step will move the P0 baseline** — it is the only remaining step that changes web output.
Capture, review the computed-style diff, and commit the baseline as the review artefact.

### Step 9 — docs (page written 2026-07-27)

[`org/docs/mobile/README.md`](../../../org/docs/mobile/README.md) now exists: the invariant, the
three legal fork reasons, every translation the native seam performs and why, the boot order, and
what the gates prove versus what they do not. Its citations resolve under `pnpm docs:check`.

Still open from this step: the two stale claims in `docs/react-native-tamagui-migration.md` (§1c and
the "blocked on §1c" note — the className blocker died when Tailwind was deleted). `pnpm docs:check`
also has **pre-existing** failures unrelated to mobile (`terminal/index.tsx` line ranges, a deleted
`button/index.css`, a moved `SettingsSchemaForm`).

### Device verification (2026-07-27 — mostly closed)

Run on `Small_Phone_API_33` (Expo Go) against the **production** gateway and a live compute pod.
What is now proven on a device:

- an authenticated session boots straight into chat; `compute/ensure` + the edge poll wake a
  scaled-to-zero pod and mount `ChatShell`
- sidebar, drawer, transcript and composer render
- a message typed on the device reaches the pod, runs a turn, and the reply **streams back**

Still NOT proven, and still honest gaps:

- a real interactive SSO login end-to-end. Password login is disabled
  (`.issues/zitadel-password-login-disabled.md`), so verification seeded an already-minted gateway
  session through `EXPO_PUBLIC_TEST_SESSION` in `apps/mobile/App.tsx` — **inert unless that env var
  is set at build time, and it is never set in a real build.** Delete it once real SSO is verified.
- the `lmthing://` scheme being registered and its redirect intercepted (`app.json` declares it)
- the Android back gesture dismissing an overlay (`platform/keyboard.native.ts`)
- transcript **scrolling** — the transcript is a `Box`, not a `ScrollView`, so the DOM
  `scrollIntoView` auto-follow is inert on native and now degrades instead of throwing. Porting it
  is its own change.

Point a dev build at a different pod with `EXPO_PUBLIC_API_BASE=…` (Android emulator host loopback
is `http://10.0.2.2:<port>`); with no override `apiBase()` already points at production.

---

## How to verify

```bash
cd sdk/org
pnpm install --frozen-lockfile
pnpm --filter @lmthing/ui test:native    # THE gate — ios + android, resolution + render suites
pnpm --filter @lmthing/ui test           # 348 tests (was 302 before chat suites were included)
pnpm --filter @lmthing/ui lint           # tokens, rn-safety, self-imports, transport, DOM, forks
pnpm typecheck && pnpm build
cd apps/mobile && pnpm bundle:android    # proves it bundles for a device, no emulator needed
```

**P0 computed-style baseline** — the review artefact for anything that changes web output:

```bash
PW_CHROMIUM=$HOME/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome pnpm test:surface
```

The `PW_CHROMIUM` override is **required on this machine**: `capture.mjs` defaults to
`/opt/pw-browsers/chromium-1194`, which does not exist here.

**Expected P0 output is 3 deltas, not 0.** `animation-light.json div[5]/[7]/[11]` opacity are
in-flight CSS animation samples and are non-deterministic. Anything else is a real change.

**Known-failing before you start** (all pass in isolation — worker-saturation flakes):
`libs/cli/src/server/session-manager.spaceref.test.ts`, `libs/cli/src/app/hooks/runtime.test.ts`,
`libs/core/src/fork/fork.test.ts` (concurrency), and `libs/cli/src/app/authoring/tokens.test.ts`
(fails on a clean tree).

---

## Traps that already cost time

- **A green `test:native` proves a module RESOLVES, not that it RUNS.** The graph gate cannot see
  `document.title = …`. That is what `lint-dom-globals.mjs` is for. Both must pass.
- **`await import()` does NOT keep a package out of Metro's graph.** Metro resolves dynamic imports
  statically. This is how `modern-screenshot` got in.
- **jsdom cannot see the native target.** `isWeb` is always true there and importing `./x.native` by
  path is not what Metro does. Only `pnpm test:native` proves fork selection.
- **`react-test-renderer` does not enforce RN's invariants.** A bare string inside a `View` renders
  fine in the suite and shows *nothing* on a device. Assert on the host TYPE of a node, not just
  `findByText`. This is exactly how the missing bullet list survived a green suite.
- **`exports` arrays are read differently by different bundlers.** Node and Metro treat an array as
  alternatives and try each; **esbuild takes the first and stops**. `libs/ui`'s `"./elements/*"` is
  an array (Metro does no directory-index resolution), so the project-app build needs
  `uiElementsDirResolve` in `libs/cli/src/app/build/pages.ts` to bridge the difference.
- **React Native has no `crypto` global** and Expo does not polyfill one. Use `platform/crypto`.
- **RN's `URLSearchParams` is real; its `URL` is not.** Parse deep links with `Linking.parse`.
- **Expo modules publish no jest mocks.** The four in `libs/ui/metro/mocks/expo-*.js` are
  hand-written and each states what it does *not* prove. `expo-crypto`'s must use
  `globalThis.crypto`, never `require('node:crypto')` — Metro cannot resolve node builtins.
- **The gate builds the graph WITHOUT mocks.** A package imported from `libs/ui/src` must genuinely
  resolve from `libs/ui` (that is why `expo-linking` is a devDependency there), even though the
  suites get the mock.
- **Committed style is single-quote, no semicolons in `libs/ui`.** Do not run `prettier --write`.

### Added by the 2026-07-27 device run

Every one of these was invisible to a green `test:native` and cost a rebuild to find.

- **`display: 'flex'` means ROW on web and COLUMN on native.** ~58 shared style objects were written
  against the CSS default. The damage is not just layout: a label carrying the web truncation idiom
  (`flexGrow: 1, flexBasis: '0%'`) has its main axis flipped, so `flexBasis: 0` sizes its HEIGHT and
  the text **disappears with no error at all**. Fixed once, in `nativeSafeProps`.
- **There is no `position: 'fixed'` in Yoga.** An overlay written the web way keeps `relative` and
  rejoins normal flow — the chat `Drawer` laid out beside the transcript instead of over it. Also
  translated in `nativeSafeProps`.
- **A `$`-token that is not in the scale you think reaches Android as a raw string.**
  `lineHeight="$6"` — `$6` is not a key in the lineHeight ramp (`xs`/`sm`/`base`/…) — crashed the
  composer with `java.lang.String cannot be cast to java.lang.Double`. Same class killed the
  transcript via the em-relative `letterSpacing` scale.
- **`console.error` for the text-nesting invariant carries NO component stack.** Do not try to read
  one off the device; reproduce it in the harness instead by walking the mounted tree
  (`metro/suites/chat-shell.tsx`). Component-stack attribution guessed from the surrounding UI was
  wrong for hours — the errors were never in the component they appeared to come from.
- **DOM refs are not null on native, they are the wrong object.** `bottomRef.current?.scrollIntoView`
  and `textareaRef.current.style.height` both survive a null-guard and then throw. Guard the METHOD
  (`?.scrollIntoView?.()`), not the ref.
- **`CI=1 expo start` disables the file watcher** — "reloads are disabled". After any source edit the
  dev SERVER must be killed and restarted; force-stopping Expo Go re-serves the same stale bundle.
  Confirm with `curl` against the served bundle before believing a fix did not work.
- **Metro dies with `ENOSPC` if another Metro is running.** `lsof -ti:8081 | xargs -r kill -9` first.
  Port 8081 left occupied also makes `expo start` bail in non-interactive mode.
- **Run `pnpm install` from `sdk/org`, never only from the repo root.** The root install relinks
  `libs/ui`/`apps/mobile` dependencies into the PARENT store, which is outside `apps/mobile`'s Metro
  `watchFolders` — every one of them then fails to resolve. `pnpm install --force` from `sdk/org`
  repairs it.
- **Icons are a fork now.** Import from `elements/primitives/icons`, never `lucide-react` (no RN host
  component for `<path>`) and never `@tamagui/lucide-icons-2` directly (drags React Native into the
  web bundle — it took `apps/web` from 2638 to 4397 modules).

---

## Open issue you should know about

Commit **`393a5ea`**, titled *"fix(teams): #general was never seeded once another channel came
first"*, actually contains the whole of the deep-link / `live-send` change and **none** of that
teams fix. A parallel session's `git add -A` swept this working tree into its commit. The code is
correct and reviewed; only the message is wrong. It is already pushed and another session was active,
so it was not rewritten — `e88a57a` carries the remainder and records what happened.

**Parallel work is active on `libs/cli/src/server/` (the team feature).** Stage explicit paths; never
`git add -A` in this repo right now.
