# `@lmthing/mobile` — Expo / React Native shell (scaffold)

The native render target for the shared `@lmthing/ui` screens (Tamagui migration, Part I §6). It
consumes the SAME `tamagui.config` as web (generated from `tokens.json`, proven byte-equal to
`theme.css` by the Layer-1 parity tests) and renders the primitives' React Native forks
(`*.native.tsx`, which Metro prefers over `*.tsx`).

> **Status: scaffold.** The config shell, the primitive native forks, and this shell exist and
> typecheck; they have **not** been run on a device/simulator in CI (no native toolchain here).
> The shared libs this shell renders ARE covered without a device by the Metro harness in
> [`libs/ui/metro/`](../../libs/ui/metro/README.md) (`pnpm --filter @lmthing/ui test:native`): it
> bundles `@lmthing/ui` for `ios`/`android` with Metro and mounts the primitives, so a fork that
> stops resolving or rendering fails in ordinary CI rather than on a device. It does not cover this
> app's own bootstrap (`App.tsx`, `index.js`, the Expo dependency tree), which is still unbuilt.
> The className-driven surfaces need the native-styling decision in
> `.issues/tamagui-web-swap-blocked-by-className-layout.md` (NativeWind or a props migration)
> before the real chat/studio screens render fully — `DemoScreen` uses the primitives directly.

## Why it's excluded from the pnpm workspace

Its Expo + react-native + Tamagui dependency tree is large and native-toolchain-specific; pulling
it into the shared install/lockfile would slow every web/core session. `pnpm-workspace.yaml`
excludes `apps/mobile`, and it depends on the shared libs by `file:` path. Bootstrap it standalone:

```bash
cd apps/mobile
npm install            # or: pnpm install --ignore-workspace
npx expo start         # then press i / a for iOS / Android
```

## Layout

- `App.tsx` — `TamaguiProvider` (shared config) + system light/dark + `DemoScreen`.
- `src/screens/DemoScreen.tsx` — exercises `Box`/`Text`/`Row`/`Col`/`Pressable` native forks.
- `babel.config.js` — `babel-preset-expo` + `@tamagui/babel-plugin` (config → the shared shell).
- `metro.config.js` — watches the repo root so the shared libs' source resolves; Metro's
  `*.native.tsx` preference is what selects the primitive native forks.

## Remaining work (tracked in `docs/react-native-tamagui-migration.md`)

- Native forks for the grouped primitives (`controls`/`media`/`table`/`svg`/`misc`/`form`).
- The native styling story for the className-driven surfaces (§1c decision).
- Expo Router navigation + the real chat/studio screens; `PodTransport` wiring (already DOM-free).
