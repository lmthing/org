# No Tamagui component exposes a host node on native — refs come back `null`

**Found by** the Metro render harness (`libs/ui/metro`) while building the Dropdown native fork,
which needs `measureInWindow` on its trigger to anchor the panel.

## What

On the React Native target, a ref passed to any Tamagui-backed component is never populated:

| component | `ref.current` |
|---|---|
| `View` from `@tamagui/core` (via `theme/tamagui.config`) | `null` |
| `styled(View, …)` | `null` |
| `NativeView` (`elements/primitives/_native`) | `null` |
| `Prim.Box` (the primitive surfaces use) | `null` |
| a plain `View` from `react-native` | the host instance — `measureInWindow` and friends |

Checked in a `useEffect`, after a second commit, and again on a later tick: it is not a timing
artifact. The plain RN `View` in the same tree, same render, is measurable.

## Why it matters

Anything needing a node handle on native is blocked: measurement (`measureInWindow`, `measure`),
imperative focus, `scrollTo`, and the `onLayout`-based replacements the migration plan lists for
`getBoundingClientRect` (§7 step 8). Every primitive forwards a ref in its TYPES
(`React.forwardRef<any, …>`), so a caller has no signal that the ref will be dead — it simply never
fires.

`elements/overlays/dropdown/index.native.tsx` works around it by putting the ref on a plain
`RNView` wrapper (with `collapsable={false}`, so Android does not optimise the wrapper away). That
is fine for one component and wrong as a pattern.

## Repro

A suite under `libs/ui/metro/suites/` that renders `<Prim.Box ref={r} />` and asserts
`typeof r.current?.measureInWindow === 'function'` fails; the same assertion against a plain RN
`View` passes. `libs/ui/metro/suites/overlays.tsx` ("the panel is placed under the measured
trigger") exercises the working path through the RNView wrapper.

## Fix

Establish which it is before choosing: a Tamagui 2.5 configuration issue (the `as unknown as
React.ComponentType<any>` casts in `_native.tsx` are type-only and should not affect runtime
forwarding), or a genuine limitation of its native path. If the latter, the primitives need an
explicit host-node seam — a `hostRef` prop, or the RNView wrapper made part of `NativeView` — rather
than each caller rediscovering this.
