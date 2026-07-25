# `elements/overlays/*` pull `react-dom` into the React Native graph

**Found by** the Metro resolution gate (`libs/ui/metro`), which is the first thing in this repo able
to see the native module graph at all.

## What

`dialog`, `sheet` and `context-menu` each `import * as ReactDOM from 'react-dom'` for a
`document.body` portal:

- `libs/ui/src/elements/overlays/dialog/index.tsx:2`
- `libs/ui/src/elements/overlays/sheet/index.tsx:2`
- `libs/ui/src/elements/overlays/context-menu/index.tsx:2`

There is **no `index.native.tsx` fork for any of them**, even though `dialog/index.tsx`'s own header
comment states "the native app supplies a `.native.tsx` fork (RN Modal) behind the same names". So
on native these resolve to the web file and drag `react-dom` — the DOM renderer — into the bundle.

## Repro

Add the overlays to the native entry and run the gate:

```bash
# libs/ui/metro/entries/surface.ts
+ import * as Dialog from '../../src/elements/overlays/dialog'
+ export const overlays = { Dialog }

pnpm --filter @lmthing/ui test:native:gate
#   FAIL [web-only-leak] react-dom reached the ios graph (react-dom is the DOM renderer;
#        native renders through react-native). First module: …/react-dom/cjs/react-dom.development.js
```

## Why it is not already failing CI

`entries/surface.ts` — the gate's frontier marker — covers `elements/primitives` and `platform`
only. The overlays are outside it precisely because of this, which is why the gate is green while
the defect stands.

## Fix

Add `index.native.tsx` forks built on RN `Modal` (the plan's §7 step 7), exporting the same compound
API, then add the overlays to `entries/surface.ts` so the gate covers them. Rendering assertions
belong in a new `libs/ui/metro/suites/overlays.tsx`.

Until then the three overlays are web-only in fact, and `dialog/index.tsx`'s comment is wrong.
