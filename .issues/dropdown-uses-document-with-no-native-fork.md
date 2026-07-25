# `elements/overlays/dropdown` subscribes to `document` with no native fork

**Found by** review while forking the other three overlays for native
(`libs/ui/metro` — the graph gate cannot catch this one, see below).

## What

`libs/ui/src/elements/overlays/dropdown/index.tsx:89-91` closes the menu on outside-click and ESC:

```ts
document.addEventListener('mousedown', onDown)
document.addEventListener('keydown', onKey)
```

There is no `document` on React Native, and there is no `index.native.tsx`. `dialog`, `sheet` and
`context-menu` had the same problem plus a `react-dom` portal; they now have forks. Dropdown is the
one left.

## Why the Metro graph gate does not catch it

The gate reports web-only MODULES in the native graph. Dropdown imports nothing web-only — it
reaches a browser GLOBAL at runtime, inside a `useEffect` guarded by `open`. So the file bundles
cleanly and only throws when a user opens the menu on a device. Catching it needs a render case with
the dropdown open, which needs the fork to exist first.

## Fix

An `index.native.tsx` alongside the other three: RN `Modal` for the surface, backdrop press +
`onRequestClose` in place of the `mousedown`/`keydown` listeners. Then add it to
`libs/ui/metro/entries/surface.ts` and `EXPECTED_NATIVE_FORKS`, with cases in
`libs/ui/metro/suites/overlays.tsx` that open it.
