# `$radius-*` tokens reach React Native as `"0.375rem"` strings

**Found by** the Metro render harness (`libs/ui/metro`) — visible in the RN element tree of any
component using a radius token.

## What

`libs/ui/src/theme/tamagui.config.ts` builds the radius scale as the exact CSS strings from
`tokens.json`, deliberately, so web output equals `--radius-*`:

```ts
const radiusTokens = { ...radius, true: radius['radius-md'] } as Record<string, string | number>
```

Colors and themes take the web/native branch (`buildColorTokens(isWeb)` / `buildThemes(isWeb)`),
but **radius has no such branch**, so native gets the web strings. The overlay panel mounts with:

```json
"borderTopLeftRadius": "0.5rem", "borderTopRightRadius": "0.5rem", …
```

React Native takes border radii as numbers (density-independent pixels). `rem` is a CSS unit with
no meaning on native; the value is not a rounded corner, it is a string RN will reject or coerce.

## Repro

```bash
pnpm --filter @lmthing/ui test:native --platform ios
```

then read any panel style in the tree — e.g. `libs/ui/metro/suites/overlays.tsx`, the Dialog panel
(`DIALOG_BASE` sets `borderRadius: '$radius-lg'`).

## Scope

Every native component that uses a `$radius-*` token — the overlay forks, and anything the
`elements/` layer ports next. It does not affect web, where the strings are correct.

## Fix

Mirror the pattern the colors already use: a `buildRadiusTokens(web: boolean)` that returns the CSS
strings on web and the resolved px numbers on native, exercised from both branches by
`src/theme/tamagui-config.test.ts` (which already parameterises `buildColorTokens`/`buildThemes` for
exactly this reason). Then assert the resolved number in a `libs/ui/metro` case, since a jsdom test
cannot see the native branch as the config the app actually gets.
