# Metro cannot resolve the codebase's `.js` import specifiers

**Found by** the Metro harness (`libs/ui/metro`) while checking how surfaces reach the overlays.

## What

Much of `libs/ui` imports with an explicit `.js` extension against a `.tsx` file — the TypeScript
NodeNext convention:

```ts
// libs/ui/src/studio/space/space-list/index.tsx:16
import { DIALOG_BACKDROP, DIALOG_CONTENT, DIALOG_HEADER } from '../../../elements/overlays/dialog/index.js'
```

Vite resolves this on web. **Metro does not**, and it does not fall back to the web file either — it
fails outright:

```
UnableToResolveError: Unable to resolve module ../../src/elements/primitives/box/index.js
  candidateExts: [ '', '.ios.js', '.native.js', '.js', … '.native.tsx', '.tsx' ]
```

Metro appends platform extensions to the specifier as given; `index.js.native.tsx` does not exist,
and `index.js` does not either.

## Why it is not failing today

`libs/ui/metro/entries/surface.ts` — the native frontier — covers `elements/primitives`,
`elements/overlays/{dialog,sheet,context-menu}` and `platform`, whose barrels import without the
extension. Every `.js` specifier in the repo sits in `chat/`, `studio/` and `computer/`, which are
not ported yet.

## Why it matters

It is a hard blocker for the surface port, and it is invisible until the moment a surface is added
to the native entry. It also means the `.native.tsx` overlay forks are not reachable from the
studio call sites above **as written** — those files would need the extension dropped before they
could bundle for native at all.

## Fix (pick one, deliberately)

1. **Drop the `.js` suffixes** in the surfaces as they port. Correct, mechanical, and works
   everywhere; large diff.
2. **A `resolveRequest` in the Expo app's `metro.config.js`** that retries a failed `.js` specifier
   as `.ts`/`.tsx`. Small, but it is bundler configuration standing in for a source convention, and
   it must go in `apps/mobile/metro.config.js` too — **not only** in `libs/ui/metro/config.cjs`. A
   harness that resolves what the real app cannot is worse than no harness.
