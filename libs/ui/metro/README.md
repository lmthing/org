# `libs/ui/metro` — the Metro / React Native test harness

Runs the shared `@lmthing/ui` code **through Metro, on the React Native target**, in an ordinary
`pnpm install`. No Expo, no simulator, no Xcode/Android SDK.

```bash
pnpm --filter @lmthing/ui test:native            # gate + render suites, ios AND android
pnpm --filter @lmthing/ui test:native:gate       # resolution gate only (fast)
node metro/cli.mjs --platform ios                # one platform while iterating
pnpm test:native                                 # same thing, from the repo root
```

## Why this exists

The Tamagui migration produced a native target that nothing could execute:
`*.native.tsx` primitive forks, `platform/*.native.ts` seams, `*.web.tsx` widget seams, and an Expo
shell in `apps/mobile` that is **excluded from the workspace** and has never been built in CI. So
three whole classes of defect were invisible:

| what could break | who noticed before |
|---|---|
| a native fork not selected by Metro, or the web sibling pulled in by an explicit path | nobody |
| a web-only module (`react-dom`, Monaco, xterm) reaching the native graph | nobody |
| a fork that imports `react-native` / `-svg` / `-webview` failing to load or render | nobody — the jsdom suite skips exactly these |

`src/elements/primitives/native-forks.test.tsx` is the closest prior art and it is explicit about
its limits: it imports `./box/index.native` **by path** (which is not what Metro does) and only
touches the forks that avoid `react-native`. This harness is the other half.

## What runs

**1 · The resolution gate** (`graph-gate.mjs`) builds the real Metro graph for
`entries/surface.ts` and asserts three things per platform:

- every `*.native.tsx` fork whose web sibling exists is the one Metro picked, and the web sibling
  is **not** in the graph;
- every fork in `EXPECTED_NATIVE_FORKS` was reached (so the entry cannot quietly stop covering one);
- no web-only module and no `*.web.tsx` seam file leaked in.

`entries/surface.ts` is the **frontier marker**: what is imported there is proven to bundle for
native. Porting a surface means adding it there and making the gate green.

**2 · The render suites** (`suites/`) bundle `entries/tests.ts` with React Native's native modules
mocked, run it in a child Node process, and assert on the React Native element tree that
`react-test-renderer` mounts — the same renderer RN's own jest preset uses.

Both platforms are always built: `ios` and `android` resolve different files and mount different
native views (`RNSVGSvgView` vs `RNSVGSvgViewAndroid`, `RCTSinglelineTextInputView` vs
`AndroidTextInput`), so a green `ios` is no evidence about Android.

## How the pieces fit

| file | role |
|---|---|
| `config.cjs` | the one Metro config — `projectRoot` is the REPO ROOT so the workspace libs resolve |
| `../metro.config.cjs` | the same config where the `metro` CLI looks for it |
| `native-mocks.cjs` | RN's native-module seam as a `resolveRequest` redirect (see below) |
| `transformer.cjs` | RN's babel transformer + one rewrite so RN's own mocks are bundleable |
| `globals.cjs` | the host environment a bundle expects, preloaded into the child process |
| `build.mjs` | `buildNativeGraph` (resolve only) and `buildNativeBundle` (serialise) |
| `run.mjs` | executes a bundle, parses the tagged NDJSON results back |
| `harness.ts` | the ~100-line `test`/`expect` that runs INSIDE the bundle |
| `render.tsx` | `render`/`find`/`press`/`styleOf` over the RN element tree |
| `cli.mjs` | the runner + exit code |

## The three things worth knowing before editing this

**Mocks are applied at RESOLUTION, not at module registry.** A Metro bundle contains the real React
Native, which expects a native host — the first `TurboModuleRegistry` call throws
`__fbBatchedBridgeConfig is not set`. Jest fixes this with `jest.mock`; a bundle has no registry to
patch, so `native-mocks.cjs` swaps the same module list one level down, in `resolver.resolveRequest`.
The mock files are RN's own (and, for AsyncStorage/Clipboard, the ones those packages publish), so
the behaviour under test stays ours.

**RN's components are NOT mocked, so host names are the native ones.** Jest also replaces `View`,
`Text`, `TextInput`… with `jest/mockComponent.js`, which loads the real module through
`jest.requireActual(moduleName)` — a require with a computed argument that Metro cannot resolve.
Rather than re-author those mocks, the harness lets the real components run: a `View` appears in the
tree as `RCTView`, a `Text` as `RCTText`. Use the `NATIVE_*` constants and the matcher helpers in
`render.tsx` instead of hard-coding names.

**There is no `onPress` prop on a mounted native node.** React Native routes presses through the
responder system, so `onPress` becomes `onStartShouldSetResponder` / `onResponderGrant` /
`onResponderRelease` on the host element. Asserting on an `onPress` prop tests nothing here — use
`press(node)`, which drives the real sequence.

## What this does NOT prove

- **Layout and paint.** `react-test-renderer` runs the reconciler, not Yoga and not a GPU. A style
  reaching the native view is proven; what it looks like is not.
- **Anything a native binary does.** Every native module is a mock or a stub. "The webview mounts
  with this url" is the claim; "the page loads" is not.
- **The Expo shell.** `apps/mobile` is still outside the workspace with its own dependency tree.
  This harness covers the shared libs it renders, not its bootstrap.
- **The `@tamagui/babel-plugin` extraction path.** The harness bundles with the plain RN preset, the
  same as `disableExtraction: true` on web.

## The gate that lives outside this directory

`libs/ui/scripts/lint-import-extensions.mjs` (part of `pnpm --filter @lmthing/ui lint`) forbids a
`.js` extension on a relative import of a TypeScript file. It is here in spirit: Metro appends
platform extensions to the specifier as written, so `from './x.js'` against `x.tsx` fails the native
build outright — it does not fall back. 411 of those were the blocker for porting the surfaces.
`core` and `cli` use NodeNext, where the extension is required; the gate is scoped to `libs/ui`.

## Cost

Roughly 20–35 s per platform cold, a few seconds warm (Metro caches transforms under
`node_modules/.cache`). That is why it is a separate `test:native` script rather than part of
`pnpm test`.

## A note on the workspace

`react-native`, `react-native-svg` and `react-native-webview` were already installed here as
`@lmthing/ui`'s optional peers, and Metro itself arrives with react-native — which is what makes
this harness cheap. It adds `metro`, `@react-native/metro-config`, `@react-native/babel-preset`,
`@react-native/metro-babel-transformer`, `@react-native/jest-preset`, `react-test-renderer` and
`@babel/runtime` as **devDependencies of `libs/ui` only**.

pnpm installs `react-native` once per distinct peer set, so the store holds several physically
separate copies. That is why the mock table is keyed by a module's path *inside its own*
`react-native` package rather than by an absolute path — see the comment on `buildMockTable`.
