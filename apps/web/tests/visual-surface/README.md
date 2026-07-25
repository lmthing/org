# P0 — the real-surface computed-style baseline

The review artefact for the two remaining changes that alter output app-wide: **the animation
driver** and **the Tailwind deletion**. Neither can be reviewed by reading a diff. Both can be
reviewed as a computed-style delta over the components the app actually ships.

```bash
pnpm test:surface          # build + compare against __baseline__/  (exit 1 on any delta)
pnpm test:surface:update   # re-capture — a deliberate, reviewed act; commit the baseline diff
```

## What it renders

`harness/fixtures.tsx` imports the **shipped** components from `@lmthing/ui` — the ones `apps/web`
imports — and mounts them inside the same `TamaguiProvider` the app uses, under the real
`theme.css` (Tailwind **preflight** + the token custom properties) *and* `chat/app/styles.css`
(which owns the `lm-*` keyframes). Both themes are captured from one build via `?theme=`.

Eight fixtures: `typography` · `forms` · `content` · `layout` · `nav` · `leaves` · `state-props` ·
`animation`. ~196 elements across light + dark.

Two of them exist for specific reasons:

- **`state-props`** — `hoverStyle`/`pressStyle`/`focusVisibleStyle` and the `group`/`$group-*-hover`
  pair. These replaced every `:hover`/`:hover .child` CSS rule in the migration, and both halves of
  a group fail *silently* if they come apart.
- **`animation`** — the 67 remaining `transition-*` / `animate-*` / `lm-*` classNames, the last
  Tailwind dependency. Captured with their real resolved `transition-property`/`duration` and
  `animation-name`/`duration`/`iteration-count`, so replacing them with a driver is a readable
  delta rather than a leap of faith.

## Why not `tests/visual/`

That harness exists and works, but its fixtures render **local passthrough copies** of the
pre-Tamagui primitives (see the comment at the top of `tests/visual/harness/fixtures.tsx`) — kept
that way so its pre-swap baselines stay byte-valid. It therefore says nothing about the components
that ship today. This harness is the complement: real components, real CSS, real preflight.

## Notes

- Chromium is the pre-installed browser at `/opt/pw-browsers` — do **not** run `playwright install`.
  Override with `PW_CHROMIUM`; `playwright` itself resolves out of the pnpm store (`PW_PLAYWRIGHT`).
- `harness/harness.css` re-declares `@source` for `apps/web/src` and `libs/ui/src`. Tailwind v4
  auto-detects sources relative to the build root, which here is the harness directory — without
  them the utilities the shipped components still carry would be missing from the harness CSS and
  the baseline would understate what the Tailwind deletion removes.
- The audited property set lives at the top of `capture.mjs`. Adding a property invalidates the
  baseline; re-capture and review.

See `docs/tamagui-idiomatic-migration.md` §2.
