# `@lmthing/mobile` — the Expo / React Native app

Renders the **shared** `@lmthing/ui` surfaces on React Native. Not a port, not a parallel
implementation: the same source the web app renders, through the primitives' `*.native.tsx` forks.
The plan, the invariant it follows, and the measurements behind it →
[`docs/mobile-native-chat.md`](../../docs/mobile-native-chat.md).

```bash
pnpm install                      # from sdk/org — this app is IN the workspace
cd apps/mobile
pnpm start                        # Expo dev server; press a / i
pnpm bundle:android               # prove it bundles, no device needed
pnpm typecheck && pnpm lint
```

## What this shell is allowed to contain

The provider, the entry point, and (later) push registration. That is the whole divergence budget.

Screens live in `@lmthing/ui`, where both targets render them from one source — a screen written
*here* would be a fork of the product that no gate could see. `scripts/lint-barrel-imports.mjs`
enforces it by refusing deep imports into a shared package's internals; public subpaths
(`@lmthing/ui/elements/*`, `/chat`, `/theme/*`) are the same entry points the web app uses.

`App.tsx` supplies `TamaguiProvider` with the shared `tamagui.config`, generated from the same
`tokens.json` as the web `theme.css` and proven byte-equal by the Layer-1 parity tests — so a colour
or a radius cannot mean one thing here and another on web.

## Why it is in the pnpm workspace

It used to be excluded, on the grounds that its Expo + react-native tree was too heavy to inflict on
every web/core session. That stopped being true: `react-native` (35 MB), Metro and the whole
`@react-native/*` toolchain are already installed as `libs/ui`'s devDependencies, for the Metro
harness. Adding this app cost ~130 packages.

Being outside was not free. The old scaffold pinned React 18.3.1 while the libs moved to React 19,
nothing ever installed it, and it was never once built — in one lockfile that is a peer conflict the
day it appears rather than a discovery months later.

## What is proven, and by what

| Claim | Proven by |
|---|---|
| the shared libs resolve and transform for ios + android | `pnpm --filter @lmthing/ui test:native` (the Metro graph gate) |
| the primitives, overlays and markdown actually mount and style | the render suites in `libs/ui/metro/suites/` |
| **this app** bundles for a device | `pnpm bundle:android` / `pnpm bundle:ios` |
| it runs | an Android emulator. **iOS cannot be verified on Linux** — the harness covers its graph and render tree, not a real device |

`babel.config.js` must keep `@babel/plugin-transform-export-namespace-from`: the shared
`chat/index.ts` uses `export * as`, which `@react-native/babel-preset` does not transform. The Metro
harness enables the same plugin, and a green harness says nothing about *this* build without it.
