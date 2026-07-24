# Tamagui web-swap of the layout primitives is blocked by the Tailwind-className surfaces

**Status:** DECIDED → **Option B** (Tamagui compiler + migrate the surfaces' layout onto Tamagui
props / `Row`/`Col`). The zero-context execution plan is **Part III** of
`docs/react-native-tamagui-migration.md` — start at "B0" (the pivotal spike: does className win
over Tamagui atomic styles with `@tamagui/vite-plugin`?). This issue stays open until B lands or
B0 forces re-opening the decision. Found 2026-07-23 while starting Phase 1c.

> **Update 2026-07-24 — Phase-2 foundation landed; the two hard blockers are cleared.**
> The idiomatic-Tamagui execution now has a plan (`docs/tamagui-idiomatic-migration.md`) and its
> load-bearing pieces are done + tested:
> - **Theming blocker (this issue's §"Why fundamental" point 1) is resolved by SPIKE A1**: web colors
>   are `var(--<name>)`-backed Tamagui TOKENS (not injected themes), so `backgroundColor="$background"`
>   is idiomatic AND keeps `theme.css`'s runtime cascade (data-theme + per-space overrides). The empty
>   `app` theme stays, so nothing collides. Proven in `apps/web/b0-probe/spike-a-runtime-theme.spec.ts`.
> - **The className→props migration (this issue's core) has a tool**: `libs/ui/scripts/classnames-to-props.mjs`
>   (+ a 31-test mapping gate) mechanically lifts static Tailwind classes to props; `--check` over the
>   chat surface = 228 elements migratable / 110 flagged for manual review.
> This issue stays open until the surface sweep + config convergence (§5–§7) actually land across the
> app — the tooling is ready but the shipped surfaces are not yet migrated (per-slice, harness-gated).

## Summary
The Phase-0 de-HTML produced surfaces whose layout is **100% Tailwind-className-driven**, with
**everything mapped to `Box`** (114 files use `Box`; **`Row`/`Col` are used 0 times**). Swapping
`Box`'s internals to a Tamagui `styled(View)` on **web** cannot be done without regressing layout,
so the web half of the "Tamagui swap" (§4/§7 steps 6–7) is blocked as currently structured.

Web-side parity was NOT compromised: the L2/L3 harness (`tests/visual/`) and the primitives remain
the proven passthrough. This issue is about the *next* step, not a live regression.

## Evidence (grounded, this checkout)
1. **`Box` carries layout via className.** `grep 'Prim.Box className' libs/ui/src/{chat,studio,computer}`:
   **87** `Box` usages contain `flex`. Of those, **61** have neither `flex-col` nor `flex-row` — they
   rely on Tailwind's default **flex-direction: row**.
2. **Tamagui `View` base is flex-direction: column.** A bare `styled(View)` renders `display:flex;
   flex-direction:column`. So those 61 row-default layouts would silently flip to **column**.
3. **Tamagui's atomic CSS overrides className by source order.** Probe (createTamagui runtime, no
   compiler): a `styled(View,{display:'block'})` with `className="fx-card"` (where `.fx-card{display:flex}`)
   computed to `display:block` — Tamagui's runtime-injected `_dsp-block` (specificity 0,1,0) beat the
   equal-specificity `.fx-card` because it was injected later. So "className wins during coexistence"
   (plan §5) does **not** hold for equal-specificity properties without build-time order/specificity
   control.
4. **`Row`/`Col` exist but were never emitted** by the de-HTML codemod, so there is no per-element
   signal of intended direction to drive an automatic block-vs-flex mapping.

## Why this is fundamental, not a bug to patch
- On **web**, the safe behavior is "the primitive imposes no layout; className owns it" — i.e. `Box`
  must stay a plain passthrough. A Tamagui `styled()` inherently emits View base styles
  (display/flex-direction/flex-shrink) that conflict with the className layer.
- On **native**, the surfaces' Tailwind classNames are **meaningless** (no Tailwind runtime). Tamagui
  primitives do **not** interpret className, so porting the className-driven surfaces to native needs a
  className→style engine (**NativeWind**) OR a migration of the surfaces' layout to Tamagui props.
  Tamagui-for-layout-primitives does not, by itself, make the current surfaces render on native.

## Options (decision required — see doc §"Phase 1c decision")
- **A — NativeWind for layout.** Keep the className-driven surfaces verbatim (web unchanged);
  add NativeWind so the same classes style RN. Use Tamagui only for the universal *overlay*
  components (the Radix replacements, §6) if wanted. Best fit for what Phase 0 produced; lowest web
  risk. Pivots away from Tamagui-for-primitives.
- **B — Tamagui compiler + surface layout migration.** Add `@tamagui/vite-plugin` (extract + control
  specificity) AND migrate the 87 flex `Box`es' layout from className to Tamagui props / `Row`/`Col`.
  Delivers the plan's Tamagui vision but re-edits surfaces (contradicts "surfaces not edited again")
  and must be verified against a real app build.
- **C — Keep web passthrough; defer native.** Ship the completed, verified work (Phase 0 + config
  shell + L2/L3 harness) and pause the swap until the styling architecture is chosen.

## What is safe and done regardless of the choice
- `libs/ui/src/theme/tamagui.config.ts` (createTamagui shell) + its runtime parity test.
- `tests/visual/` L2/L3 harness + passthrough baselines (the gate for whichever path is chosen).
- Web primitives + surfaces remain the proven Phase-0 passthrough.
