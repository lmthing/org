# Mobile — a native `chat` surface, from the same source as web

**Decision (2026-07-26).** Build a real React Native app whose chat surface renders through the
Tamagui native forks — not a WebView shell, not a PWA. Delete `apps/mobile` (an Expo 52 / RN 0.76 /
React 18 scaffold that has never been installed or run) and regenerate it against the current libs.

**The constraint that governs every step below: the same code runs on web and mobile.** Not "shared
where convenient" — the surfaces are one source, and a per-platform file is a failure that has to
justify itself against a fixed list of reasons. §"The invariant" states the list and the gates.

`studio/` and `computer/` are **out of scope, permanently for this plan**. They are desktop surfaces
(Monaco, xterm, a file tree, multi-pane layout) and already have `UnavailableOnMobile` native stubs.
The mobile product is chat plus the things only a native app can do.

## Where this starts from — measured, not assumed

Everything below was re-measured in this checkout on 2026-07-26, after `86e7bab` (the Tailwind
deletion). Re-measure before trusting a number.

| | state |
|---|---|
| native forks in `libs/ui/src` | **23** — 14 primitives, 4 overlays, 3 `platform/` seams, plus `.native` stubs for Monaco (`computer/ide-editor.native.tsx`) and xterm (`elements/content/terminal/index.native.tsx`) |
| proven to bundle for ios+android | primitives, `platform/`, and the 4 overlays — whatever `metro/entries/surface.ts` imports |
| NOT in the native graph | `chat/`, `studio/`, `computer/`, and `elements/` above the primitives+overlays |
| migratable utility classNames | **0** across 268 files (`node libs/ui/scripts/classnames-to-props.mjs --check …`); 33 dynamic `{className}` passthroughs reported for manual review |
| chat files touching `document`/`window`/`localStorage` | **15** of 63 |
| relative `/api/*` fetches in `chat/` | **12** |
| `dangerouslySetInnerHTML` sites | **5** (`chat/app/Message.tsx`, `chat/components/DisplayBlock.tsx`, `chat/components/render-descriptor.tsx`, `elements/content/markdown/index.tsx`, `studio/.../markdown-preview.tsx`) |
| `pnpm test:native` on this machine | **cannot run** — `ENOSPC`, `fs.inotify.max_user_watches` is 65536 and watchman is absent |
| `test:native` in CI | **not wired** — `.github/workflows/` has only `build-images`, `design-tokens`, `docs-sync` |

### How far Tamagui alone gets `chat/` — all 63 files, classified

Tamagui is fully integrated and finished on the axis it owns: styling and host elements. It was
never going to address the platform-API axis, and that is what remains. Every non-test file in
`chat/`, by what would happen on native today:

| | files | why |
|---|---|---|
| **already cross-target** | **20** | the whole `store/` layer (`store.ts` + 6 slices, `model.ts`), `useReplSession`, `AskBlock`, `ConsentCard`, `VariablesBlock`, `tree`, `replay` |
| `className` only | 20 | dropped **silently** by `nativeSafeProps` — mounts, renders unstyled |
| touches `document`/`window`/`localStorage` | 17 | step 3/4/5 seams |
| origin-relative `/api` or `new WebSocket` | 8 | step 3 |
| `dangerouslySetInnerHTML` | 3 | step 6 |
| web-only library (`react-dom`/xterm/Monaco) | **0** | all confined to `studio`/`computer` |

Two of those rows are load-bearing for planning. **Zero web-only libraries in `chat/`** — the desktop
dependencies never leaked out of the desktop surfaces. And **the state layer is already clean**,
which is normally the expensive half of a port.

The `className`-only row is the dangerous one: on native those files mount and render **unstyled**
rather than failing, the same silent shape as the three dead `group-hover:` reveals the migration
already found. They need `{className}` → style props, not a fork.

**This table is static inference.** Nothing has ever bundled `chat/` for native; `surface.ts` is the
only thing that can settle it. That is why step 0 is step 0.

**The §1c blocker is gone.** `docs/react-native-tamagui-migration.md` §1c and
`apps/mobile/README.md` both say the className-driven surfaces block the native port. That was true
when written; Tailwind was deleted in `86e7bab` and layout is style props now. Both documents are
stale and are corrected by step 10.

---

## The invariant: one source, two outputs

Every screen, every component, every store, every hook in `chat/` is **one file** that both targets
import. What differs is the leaf translation, not the code above it.

**Web does not run through `react-native-web`, and that is the design.** One source compiled to each
target's real primitives beats one source shimmed onto the wrong one. "Same code" is a claim about
the source, not about the renderer.

### Why not react-native-web (asked and answered — don't re-litigate)

RNW renders **React Native components on the web**. That is the opposite direction from the one this
plan needs: the surfaces are DOM-authored, so RNW makes no line of `chat/` run on native. Getting
value from it means rewriting every surface in RN vocabulary and back-rendering to web — a rewrite
of the shipping web app, which would also leave every actual blocker untouched
(`dangerouslySetInnerHTML`, origin-relative `/api/*`, `localStorage` auth, `history`-based
`url-state`). Steps 3–6 are identical with or without it.

Tamagui already fills that slot, and its web output is better here on three counts:

- **Real host tags.** `_tamagui.tsx` builds one component per tag with
  `createComponent({ Component: 'h1', isText: true })` precisely because Tamagui's `tag` prop is a
  compile-time hint — a runtime `styled(Text)` renders `<span>` and silently drops the semantic tag
  ("headings/labels → a11y regression"). RNW renders effectively everything as `div`/`span`, and the
  de-HTML pass routed 2516 tags through primitives specifically to KEEP their element (`as` covers
  `section/nav/header/h1–h6/dl/fieldset/pre`, plus `label`+`htmlFor`, the `<table>` family,
  `<datalist>`).
- **Atomic CSS** rather than per-element style objects. The web CSS bundle is 19.52 kB, from 171 kB.
- **The P0 baseline survives.** 246 elements × ~70 computed properties, light and dark, is the
  artefact the whole Tailwind deletion was reviewed against. Swapping the web renderer invalidates
  all of it at once — losing the instrument exactly when it is most needed.

Two precisions, so the claim stays honest. RNW *is* in the tree: `react-native-web@0.21.2` arrives as
a build-time dependency of `@tamagui/static` via `@tamagui/vite-plugin`, and is never rendered. The
`WEB_ONLY` entry in `metro/graph-gate.mjs` is therefore narrower than "we reject RNW" — it keeps the
web shim out of the NATIVE bundle, where it would shadow the real React Native. And RNW would
genuinely collapse the two legitimate overlay forks (write the dropdown once as `Modal` +
`measureInWindow`, run it on web) — at the cost of a worse web result, a modal and measured
positioning where CSS `absolute`/`fixed` does it natively. Those forks buy the best implementation
per platform; they are not a failure to share.

### The only three legal reasons for a `.native` / `.web` file

1. **Host-element translation at the primitive layer.** `Box` → `View`, `Text` → RN `Text`. The
   fork's job is prop translation and nothing else (`nativeSafeProps` in
   `elements/primitives/_native.tsx`).
2. **A platform capability seam** — `platform/{storage,clipboard,dimensions}` and the ones this plan
   adds. One capability, one narrow API, two implementations.
3. **A capability that genuinely does not exist on the target**, where the fork renders
   `UnavailableOnMobile` (Monaco, xterm). The feature is *absent*, not *reimplemented*.

Reason 1 sometimes forces a real behavioural difference, and that is legitimate when the platform
makes the web implementation impossible. `overlays/dropdown/index.native.tsx` is the honest example:
RN has no `position: fixed`, so an anchored panel that also closes on outside-press needs a `Modal`
plus `measureInWindow`, and the fork documents that trade-off in full. That is a fork earning its
place. A fork that merely re-types the same idea in RN vocabulary is not.

**Never a fork of:** a screen, a store, a hook, a data-fetching path, a component with behaviour.
If a screen needs a fork, the platform difference underneath it has not been pushed down far enough.

### What already violates this, and must be fixed before chat goes native

Three things, all found by measurement:

- **Six style bags are declared twice.** `DIALOG_BACKDROP`/`DIALOG_BASE`/`DIALOG_CONTENT`/
  `DIALOG_HEADER` and `DROPDOWN_CONTENT`/`DROPDOWN_ITEM` exist in both the web and the native
  overlay file, hand-differenced (native's `DROPDOWN_CONTENT` drops `color` because RN doesn't
  inherit it into a `View`). Nothing makes them stay in step. A token change lands on one and not
  the other, silently, forever.
- **The native forks redeclare their prop types, and nothing checks them.** `box/index.native.tsx`
  types `BoxProps` as `React.HTMLAttributes<HTMLElement> & {as, open}`, while the web `Box` exports
  Tamagui's `BoxPrimitiveProps`. `tsc` only ever resolves `index.tsx`, so the native declaration is
  never verified against how surfaces actually call it — `padding="$4"` typechecks against web and
  works at runtime on native via `nativeSafeProps`, but the fork's own type says it shouldn't. Two
  prop types for one component is the seed of two components.
- **A stale comment asserts the opposite of the current behaviour.** `metro/suites/primitives.tsx`
  says the forks "destructure `style`/`children` only, so Tamagui style PROPS are dropped on
  native". `b49471d` made props flow through `nativeSafeProps`. The comment is now the loudest
  documentation of a native/web divergence that no longer exists.

### The gates that hold the invariant

- **A fork ratchet.** A lint (sibling of `lint-rn-safety.mjs`) holding the explicit list of allowed
  `.native`/`.web` files with a category from the three above. A new fork fails CI until it is added
  with a reason — the same shape as `EXPECTED_NATIVE_FORKS`, which already ratchets the other
  direction (a fork that stops being *reached* is a regression).
- **No bag declared in both siblings.** Extend the same lint: an exported `const` present in both
  `index.tsx` and `index.native.tsx` is an error. Shared values live in a platform-free `.ts` that
  both import.
- **The shell is the divergence budget.** `apps/mobile` may import only the `@lmthing/ui` public
  barrel — no deep imports into `chat/**` — so it cannot grow a screen of its own. Its content is
  entry + provider + push registration.

`metro/entries/surface.ts` is the frontier marker and `EXPECTED_NATIVE_FORKS` is the ratchet. **A
step is done when its subject is imported in `surface.ts` and `pnpm --filter @lmthing/ui test:native`
is green for ios AND android.** Nothing here is done on a claim that it should work.

The web side is protected by `pnpm test:surface` (the P0 computed-style baseline). Any step that
changes web output re-captures with `pnpm test:surface:update` and **the baseline diff goes in the
commit** — that diff is the reviewable artefact, not the code diff.

---

## Progress log

**2026-07-26 — step 0 landed, and a probe converted the table above into measurement.**

The watch limit was raised (by hand, on the dev machine) and the gate ran for the first time in this
checkout: **PASS**, both platforms, 33 render assertions. One of them —
*"Box forwards Tamagui style props to the native view"* — settles the third divergence item in step 1:
the forks DO forward props, and the header comment in `metro/suites/primitives.tsx` claiming they are
dropped is simply stale.

Then a throwaway entry importing `@lmthing/ui/chat` was fed to `buildNativeGraph`. It failed four
times, each failure naming exactly one thing. Three were harness gaps and are fixed:

1. **`export * as ns from '…'` does not transform.** `@react-native/babel-preset@0.86` ships
   `export-default-from` but NOT `@babel/plugin-transform-export-namespace-from`, so
   `chat/index.ts:18` (`export * as compat`) made the whole chat barrel untransformable while being
   valid ES2020 everywhere else. The plugin is now added to `metro/transformer.cjs` for all files.
   **`apps/mobile`'s babel config must enable it too** — the harness transforming says nothing about
   a device build whose preset lacks it.
2. **A `.css` import kills the graph.** Metro cannot resolve one for native, and 4 shared files
   import a stylesheet. `config.cjs` now redirects `.css` to the empty module — and because a silent
   redirect is precisely the failure this harness exists to catch, every redirect is recorded and
   `graph-gate.mjs` check 5 fails on any importer inside `libs/ui/src`. Verified by probe: the rule
   is inert on today's surface (0 redirects) and fires with an accurate message the moment the
   markdown element enters the graph.
3. **`@babel/runtime` helpers are unresolvable from sibling libs.** RN's preset runs
   `transform-runtime`, and under pnpm's isolated store only `libs/ui` has the package — so the graph
   died as soon as it reached `@lmthing/auth` (pulled in by `chat/app/auth.ts`). Mapped through
   `resolver.extraNodeModules`, which is the shape a real app has anyway.

The fourth is **architectural and belongs to the surface, not the harness**:

4. **`chat/` reaches into `studio/`.** `chat/app/IntegrationsTab.tsx:8` imports
   `studio/integrations/SettingsSchemaForm` — one import, and the only one. It drags in a surface
   that is explicitly out of scope. `SettingsSchemaForm` is shared vocabulary living in the wrong
   directory; it moves to `elements/`.
5. …which surfaced a fifth: **292 self-referencing `@lmthing/ui/…` deep imports** (280 of them in
   `studio/`, 11 in `components/`, 1 in `computer/`) **do not resolve under Metro**. The package's
   `exports` maps `./elements/*` → `./src/elements/*`, which lands on a DIRECTORY, and Metro does no
   directory-index resolution there. Web bundlers do, which is why nobody has noticed. The
   toolchain-independent fix is relative imports inside the package, not a harness alias — an alias
   would make the gate pass while a device build still failed.

`test:native` is green after all of the above, and CI now runs it
(`.github/workflows/native-target.yml`, including the `sysctl` the runner also needs).

**Not yet done in step 0:** `apps/mobile` is still present — it is deleted as part of step 2, where
its replacement lands, rather than leaving the tree with no mobile app at all in between.

**2026-07-26 — the transport seam (step 3), and the duplication it uncovered.**

`platform/api-base` is the fourth seam: `apiBase`/`apiUrl`/`wsUrl`, identity on web and an absolute
pod URL on native (`EXPO_PUBLIC_API_BASE`, defaulting to `https://lmthing.chat`). The default host is
not a preference — `devops/argocd/envoy/chat-policies.yaml` validates the gateway JWT on that host's
`/api` route and routes on the `sub` claim, so the **host selects the route and the token selects the
pod**. Nothing in the gateway or in `com/` needs to change for a device to reach it.

Fifteen call sites moved behind it, and four of them were the same four functions written twice:
`apiGet`/`apiPost`/`apiPut`/`apiDelete` existed character-for-character in both `Sidebar.tsx` and
`ProjectSettings.tsx`. They are `chat/app/api.ts` now — a transport seam is exactly the thing that
must not be threaded through a copy. `withAuthToken` resolves through the seam too, because an
`<Image source>` has no origin to be relative to any more than a `fetch` does.

The gate is `scripts/lint-relative-transport.mjs`, and it is deliberately narrow: it fails only on a
`fetch`/`new WebSocket` whose URL argument's **statically known leading text starts with `/`**. That
is decidable without type information and it names the actual defect — `fetch(apiUrl('/api/x'))` and
`` fetch(`${baseUrl}/api/x`) `` both pass, `` fetch(`/api/${id}`) `` does not. Verified by probe in
all four forms. Its scope is a `NATIVE_BOUND` list, currently `chat` + `platform`; a surface joins
when it actually reaches the native graph, so the gate always states what is true rather than what is
hoped.

Evidence: native gate PASS both platforms with two new assertions reached through the `platform`
barrel (so Metro's fork preference is what selects them — the web half would return `''` and fail
them); 302 unit tests; `tsc` clean; P0 shows only the three known in-flight animation-opacity samples,
no element added and no computed style changed — the zero delta this step promised.

Still relative, and deliberately so: `chat/client/rpc-client.ts` takes its `baseUrl` from
`ReplClientConfig`, threaded from the app, so it was never origin-bound. Noted for step 7:
`lib/app-urls.ts` reads `import.meta.env`, which is the next thing the graph will object to.

**2026-07-26 — the session reads on native (step 4a), and the first chat file on the graph.**

Measured before building, and it shrank the step: **`chat/` imports exactly one symbol from
`@lmthing/auth` — `getSession`.** The provider, the PIN machinery and `useRepoSync` belong to
`apps/web`. And a probe showed `@lmthing/auth` already *resolves* for android — 21 modules, no
error. So there was no bundling problem to solve at all; there was a runtime one, and a nastier kind
than a crash.

`getSession()` read `localStorage` directly. On React Native that is not an exception —
`globalThis.localStorage?.getItem(k)` is `undefined ?? null` — so the web half would have returned
**null forever, silently**, and every authenticated request in the surface would have looked merely
logged-out. Nothing would throw and nothing would say why. This is the same silent-degradation class
as the `.css` redirect and the empty markdown box, and it is why the new suite asserts a
store-then-read ROUND-TRIP rather than an import: the round-trip is the one thing the web fork cannot
pass on this target.

`libs/auth/src/platform/session-store` is the seam. It is a *keystore*, not `AsyncStorage`: the
session is a bearer token, so native persists it with `expo-secure-store`. The design tension worth
recording is that `getSession()` is **synchronous** — it is called from inside
`fetch(url, { headers: authHeaders() })` in a dozen places, so making it async would make all of
`chat/` async with it — while SecureStore is not. The resolution is a read-through cache: `hydrate()`
loads the keystore once at boot, reads come from memory, writes update memory first. The cost is
stated rather than hidden: **reads before `hydrateAuth()` resolves return null**, so `apps/mobile`
must await it before mounting, and `isAuthHydrated()` exists so that contract can be asserted.

Three gates grew to match, and each had been quietly blind:

- `graph-gate.mjs` scanned only `libs/ui/src` for forks. A fork in `libs/auth` was invisible to
  fork-selection — the one failure mode a fork gate cannot have. It now takes `FORK_ROOTS`, and its
  `.web.tsx`-leak and stylesheet-drop checks cover both packages too.
- `lint-native-forks.mjs` had the same blind spot; its paths are repo-relative now.
- `entries/surface.ts` gained `chat/app/auth.ts` — the first file of `chat/` on the native graph, and
  deliberately the smallest. The gate is what forced it: listing the new fork as expected while
  nothing reached it failed with *"the native entry no longer reaches it"*, which is the correct
  complaint.

`mocks/expo-secure-store.js` is the **one hand-written mock** in the harness — the package publishes
none, because it is an Expo module that needs a native host. Its header says what it does not prove:
not that the keystore is reached, not that anything is encrypted at rest, not that a session survives
a real restart. Those stay device claims.

Verified separately, at the code level rather than by assumption (the plan asked for exactly this):
`new URL('lmthing://auth/callback')` parses, `searchParams.set` round-trips it byte-identically, and
the gateway stores `redirect_uri` verbatim (`/sso/create`) and requires an exact match on consume
(`findAndConsumeSsoCode`) with no allowlist. So a custom-scheme redirect needs no gateway or `com/`
change. **A real device login is still what proves it** and has not been done.

Evidence: native gate PASS both platforms including 5 new session assertions; 302 unit tests;
workspace `typecheck` and `build` clean; `pnpm install --frozen-lockfile` clean;
`expo export --platform android` bundles (880 modules, 2.1 MB); full suite at 2273 passing with the
two documented pre-existing failures; P0 unchanged.

**Not done in this step:** login itself. `redirectToLogin`/`handleAuthCallback` still use
`window.location` and `sessionStorage`, which is correct for web and inert on native — the app can
*read* a session but cannot yet *obtain* one. That is step 4b.

**2026-07-26 — login (step 4b). No public API changed.**

The targets diverge in exactly one place: **how the user reaches the identity provider and how the
code comes back.** Web leaves the page and is re-entered at `callbackPath`; native opens an in-app
browser and gets the redirect handed straight back. Everything after the code arrives — one HTTP
call and one object mapping — is `sso-exchange.ts`, shared. A session mapping that drifted between
targets is precisely the duplicated *value* the fork ratchet exists to prevent.

So `platform/sso` is a fork with an asymmetric shape, and the asymmetry is the honest part:
`startLogin` never resolves on web (the page is unloading; resolving would be a lie) and resolves
with the session on native; `completeRedirect` does the work on web and is a deliberate no-op on
native, where doing anything would double-spend the code.

`platform/crypto` is the second fork, and it is not incidental. React Native ships **no `crypto`
global** and Expo does not polyfill one — checked, `expo/build/winter` installs `fetch`, `FormData`,
`TextDecoder`… and no `crypto`. So `generateState()` would have thrown on the first login attempt.
A `Math.random()` fallback was the tempting wrong answer: it still yields a distinct string, so
nothing would look broken while CSRF protection was quietly gone.

**No caller changed.** `redirectToLogin` stays `void`-returning — which is what `AuthProvider`'s
`login: () => void` needs — and on native the completed session is stored, so subscribers hear about
it through `onSessionChange`, the same channel that already carries an out-of-band token rotation.

Two things checked rather than assumed, both of which could have been silently wrong:

- **RN's `URLSearchParams` is real**, not a stub — a subset implementation with correct
  `encodeURIComponent` — so building the auth URL needs no polyfill. Its `URL`, by contrast, is
  string-backed and validates against an http/https/ftp regex, so the seam parses the redirect with
  `Linking.parse` instead. That choice is a device-behaviour claim, not a preference.
- **`Linking.createURL`, not a hardcoded `lmthing://auth/callback`.** Under Expo Go the app is
  reachable at `exp://<host>:8081/--/auth/callback`; since the gateway stores whatever string it was
  given and exact-matches it on consume, a dev build works with no special case.

The suite asserts what can be wrong in our code: the auth URL carries the app scheme, `app` and
`state`; a dismissal is not an error; a returned code is exchanged **with the same `redirect_uri`
the gateway stored**; and a mismatched `state` is rejected *before* the code is spent. That last one
was mutation-tested — replacing the check with `if (false)` fails it on both platforms, so it is not
decorative.

Three more hand-written mocks (`expo-web-browser`, `expo-linking`, `expo-crypto`), each stating its
own limits. `expo-crypto`'s reaches for `globalThis.crypto` rather than `require('node:crypto')`,
which Metro cannot resolve for a native platform — the first attempt failed the whole graph on it.

Evidence: native gate PASS both platforms with 6 new login assertions (mutation-verified); 302 unit
tests; workspace typecheck and build clean; `expo export --platform android` bundles 880 modules
(2.2 MB) **with the four Expo modules linked**; P0 unchanged.

**Still a device claim, and deliberately so:** that an OS browser opens, that the `lmthing://` scheme
is registered and intercepted, and that a real login completes end-to-end against the live gateway.
No harness can show those. `app.json` already declares `"scheme": "lmthing"`.

## Step 0 — unblock the gate (nothing else is verifiable without it)

1. Raise the watch limit on the dev machine: `sudo sysctl -w fs.inotify.max_user_watches=524288`
   (persist in `/etc/sysctl.d/`), or install watchman. Metro's file map crawls all of `sdk/org`'s
   `node_modules` and dies at 65536.
2. Add a CI job running `pnpm --filter @lmthing/ui test:native`. The harness's entire premise is
   that a broken native graph fails in ordinary CI; today nothing runs it. ~20–35 s per platform.
3. Confirm green on both platforms, then delete `apps/mobile`.

**Gate:** `test:native` green in CI on a PR that touches nothing else.

## Step 1 — close the divergence that already exists

The three violations above, plus the two new lints. Do this **before** chat goes native: chat uses
`Dialog` and `Drawer`, so it inherits whatever drift the overlay layer carries.

- Lift the six duplicated bags into a platform-free module per overlay; both forks import it. Where
  native legitimately needs a subset (the dropped `color`), the filter is code — `nativeSafeProps`
  or an explicit `omit` — not a second hand-maintained copy.
- Make each native fork import its prop type from the web sibling's type export instead of
  redeclaring it, so one type describes one component.
- Fix the stale comment in `metro/suites/primitives.tsx` and add the assertion it should have made:
  a style prop set on a fork *reaches* the native view.

**Gate:** the two new lints green; `test:native` green; `test:surface` zero delta (this step changes
no output on either target — if it does, one of the copies had drifted, and that diff is the finding).

## Step 2 — regenerate the app shell

A fresh Expo app at `apps/mobile`, pinned to a release line whose React is **19** (`@lmthing/ui`
declares `react >=19`, and `libs/ui`'s own harness devDeps are RN 0.86 tooling with
`react-test-renderer` 19.2). The deleted scaffold's React 18.3.1 against those libs is precisely why
it was never once installed.

Keep the two things the old scaffold got right: excluded from the pnpm workspace (`!apps/mobile` in
`pnpm-workspace.yaml`, with the comment explaining why), and `metro.config.js` watching the repo root
so the shared libs resolve from source. Keep `App.tsx`'s `TamaguiProvider` + `useColorScheme()`
shape; drop `DemoScreen` — under the invariant, the first thing this app renders is a real shared
screen, not a native-only demo.

**Gate:** boots on a simulator rendering a shared component; the barrel-only import lint green. This
is the first step a machine cannot check for you — it needs a simulator.

## Step 3 — the transport seam

12 call sites in `chat/` fetch same-origin `/api/*`, and `chat/app/auth.ts`'s `withAuthToken` assumes
a relative URL. Native has no origin.

Add `platform/api-base.ts` (web: `''`, same-origin, unchanged) + `api-base.native.ts` (the pod URL
through the gateway), and route every `chat/` fetch and the `ReplRpcClient` WS url through it.
`ReplRpcClient` already takes a `baseUrl` in `ReplClientConfig` — the seam is for the 12 raw fetches.
**The call sites stay one file each**; only the base resolves per platform.

**Gate:** an AST lint forbidding a string-literal `/api/` in `chat/`, wired into
`pnpm --filter @lmthing/ui lint`. Web is unchanged by construction (empty base) — `test:surface`
zero delta.

## Step 4 — auth on native

`libs/auth/client.ts` is browser-shaped end to end: `redirectToLogin` uses `window.location.href`,
state lives in `sessionStorage`, the session in `localStorage` under `lmthing_session`.

- Session storage moves onto the existing `platform/storage` seam. The session token is a bearer
  credential, so native wants SecureStore — that is a `platform/secure-storage` pair, not a reuse
  of `storage`.
- Login goes through `expo-auth-session` + `expo-web-browser` against the **same**
  `${comUrl}/auth/sso` flow with `redirect_uri` set to the app scheme (`lmthing://auth/callback`;
  the old `app.json` already declared `"scheme": "lmthing"`). One flow, one set of endpoints, two
  ways of opening a browser.

**A thing to verify, not assume:** the gateway stores `redirect_uri` with the SSO code and requires
an exact match on exchange (`cloud/gateway/src/routes/auth.ts:238-271`) — no allowlist — and
`com/src/routes/auth/sso.tsx:35` does `new URL(redirect_uri)`, which parses a custom scheme. So
native login *appears* to need no gateway or `com/` change. Prove it with a real login before
building on it; if a browser refuses the scheme redirect, this step grows a `com/` change.

**Gate:** a real login on a device; web login unchanged.

## Step 5 — navigation and deep links

`chat/app/url-state.ts` (31 lines) uses the URL as the state channel for three values — `node`,
`tab`, `follow` — via `window.location` and `history.replaceState`. `AppShell` also sends through a
`window.__LM_SEND__` global.

The chat shell is one screen with a drawer, so this needs no router. Add a `platform/deep-link` pair
exposing exactly the read/write API `url-state.ts` has today: web keeps the query string verbatim,
native reads an `expo-linking` url and holds the rest in memory. `url-state.ts` itself stays **one
file**. Replace `window.__LM_SEND__` with an explicit context or store action while you are in there
— a global object bridge only works because web happens to have one.

**Gate:** `test:surface` zero delta; existing `url-state` tests pass; a `lmthing://` deep link
selects the right node on a device.

## Step 6 — markdown and `display()` output (the real work)

This is the step that decides whether the native chat screen shows anything. All four
`marked.parse(...) → dangerouslySetInnerHTML` sites render **nothing** on native:
`_native.tsx`'s `WEB_ONLY_ATTRIBUTES` drops `dangerouslySetInnerHTML` by design.

Under the invariant there is only one available answer, and it happens to be the better one: `marked`
already exposes a lexer, so parse to **tokens** and render them through `Prim.*` — one renderer, both
targets. A native-only markdown library would be a fork of the transcript itself, which is the
single most user-visible thing in the product and therefore the last thing that should diverge. This
deletes all five `dangerouslySetInnerHTML` sites (studio's preview included) and retires the
trusted-HTML caveat in `elements/content/markdown/index.tsx`.

Two things the HTML path got for free and this must handle: code blocks (`Prim.Pre` is a
host-passthrough primitive — check what its native fork does before relying on it) and the
`.lm-prose` / `.lm-markdown` stylesheets, whose rules become props on the token renderer.

**This step changes web output** — the one place in the plan where `test:surface` legitimately goes
red. Add markdown fixtures to the P0 set *before* touching the renderer, so the baseline diff is a
readable review artefact rather than a leap of faith.

**Gate:** P0 baseline diff reviewed and committed; the token renderer in `surface.ts`; `test:native`
green.

## Step 7 — the chat surface enters the native graph

With 3–6 landed, walk `chat/` onto `surface.ts` in dependency order — leaf components first
(`Message`, `DisplayBlock`, `AskBlock`, `VariablesBlock`, `ConsentCard`), then `ChatView`, then
`AppShell`/`ChatShell`. Each addition either resolves clean or names exactly one remaining web
dependency; fix that one and move on. Add each ported fork to `EXPECTED_NATIVE_FORKS`.

Two prerequisites the probe found, both cheap and both blocking the very first import:

- Move `studio/integrations/SettingsSchemaForm` into `elements/` and repoint
  `chat/app/IntegrationsTab.tsx` — the single import that drags `studio/` into the chat graph.
- Rewrite the in-package `@lmthing/ui/…` deep imports to relative paths. Only ~12 are outside
  `studio/`, so the chat-blocking subset is small; the `studio/` bulk can wait, but nothing native
  can import a file that still uses the package-name form.

The 15 DOM-touching chat files are the work list, and **every one of them stays a single file** —
the fix is always a seam underneath, never a `.native` copy of the screen. `AppShell`'s
`isMobile`/`isTablet` breakpoints already exist for responsive web; on native they come from
`platform/dimensions` (already forked) instead of a media query, which is the pattern in miniature.

**Gate:** `surface.ts` imports `@lmthing/ui/chat`; `test:native` green both platforms; the render
suites in `metro/suites/` mount the transcript; the fork ratchet shows no new entries above the
primitive layer.

## Step 8 — animation

The residual classNames after the Tailwind deletion are mostly CSS animation hooks — `lm-fade-in`,
`lm-pulse`, `animate-pulse` — inert on native. `@tamagui/animations-react-native` is already a
dependency and the shared names (`quick`/`medium`/`slow`) already exist. Convert those classNames to
`transition` props, which are the same prop on both targets.

Two traps already paid for once, documented in `docs/tamagui-idiomatic-migration.md`: the prop is
`transition`, **not** `animation` (Tamagui 2.5 renamed it and silently ignores the old name), and
`animateOnly` entries must be hyphenated CSS property names.

**Gate:** the `animation` P0 fixture, plus a render-suite assertion on native.

## Step 9 — the reason the app exists: push

A pod runs agent work while the phone is asleep. A notification on turn completion / `ask()` / a
tasklist finishing is the capability that justifies a native app over the responsive web surface that
already works. Gateway + pod work, not UI work: a device-token registration endpoint and a
notification emitter on the existing event pipeline. Scope it as its own plan once step 7 is green;
do not let it block the surface port.

## Step 10 — the docs, which are part of the change

`org/docs/` has **no mobile page at all**. Per `org/docs/SYNC.md` this work is not done without one.

- Add `org/docs/mobile/README.md`: the invariant and its three legal fork reasons, the seam model,
  what the Metro gate proves and what it does not, and what is deliberately web-only.
- Correct the two stale claims: §1c in `docs/react-native-tamagui-migration.md` and the "blocked on
  the §1c decision" note in the regenerated `apps/mobile/README.md`. The className blocker is gone.
- `pnpm docs:check` must resolve every citation on the new page.

---

## Definition of done

1. `apps/mobile` boots on ios and android and renders the real chat transcript against a pod.
2. `metro/entries/surface.ts` imports `@lmthing/ui/chat`; `pnpm --filter @lmthing/ui test:native` is
   green for both platforms **in CI**.
3. **No `.native`/`.web` file above the primitive/platform/absent-capability layer**, held by the
   fork-ratchet lint. No exported style bag declared in two siblings. No prop type redeclared in a
   fork.
4. `apps/mobile` imports only the `@lmthing/ui` public barrel and contains no screen of its own.
5. Zero `dangerouslySetInnerHTML` in `libs/ui/src`.
6. No string-literal `/api/` path in `chat/`, held by a lint.
7. Login works on a device through the existing SSO flow.
8. `pnpm test:surface` green, with every legitimate baseline change reviewed as a committed diff.
9. `org/docs/mobile/` exists and `pnpm docs:check` passes.

## Explicitly not in scope

`computer/`, offline mode, a local pod on the device, tablet-specific layout, and push (step 9 is a
separate plan). Anything not on the done list above.

**`studio/` is out of scope for THIS plan, not for the product** (decided 2026-07-26). The mobile app
is intended to carry chat *and* studio; chat goes first because it is the surface worth having on a
phone and because it is the smaller graph. Nothing here should assume studio stays on web — the seams
are written surface-agnostic for that reason, and `lint-relative-transport.mjs`'s `NATIVE_BOUND` list
is one line away from including it. What studio will additionally need, already visible from the
divergence audit: the two `absent` forks (Monaco, xterm) become real decisions rather than fallbacks,
and its 280 self-referencing deep imports are already fixed.
