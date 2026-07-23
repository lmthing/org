# Visual / computed-style parity harness (Tamagui migration §3)

The **Layer-2 (computed-style)** and **Layer-3 (screenshot)** halves of the three-layer parity
gate that makes the Tamagui migration safe. Layer 1 (token parity) is proven separately and
byte-for-byte by `libs/css/src/__tests__/token-parity.test.ts` + `libs/ui/src/theme/tamagui-config.test.ts`.

## What it proves

The `@lmthing/ui` **primitives** (`Box`/`Text`/`Pressable`/`Row`/`Col`/…) are rendered against
frozen fixtures. Baselines are captured from the **passthrough** (plain-HTML) primitives; when
the primitives' internals swap to Tamagui `styled()` (Phase 1c), the SAME fixtures are re-rendered
and compared:

- **L2 — `computed-style.spec.ts`**: `getComputedStyle` for an audited property set
  (`audited-properties.ts`) on every element, compared **exactly** (string equality) to the
  committed baseline in `__computed__/`. This deterministically catches a `div`→flex box-model
  regression (`display:flex`, `flex-shrink:0`, `align-items:stretch`, `box-sizing`).
- **L3 — `visual.spec.ts`**: a Playwright screenshot per fixture diffed against `__screenshots__/`
  at ≤0.1% pixels (`maxDiffPixelRatio: 0.001`). A noise budget only — L1+L2 are exact.

The harness is **self-contained** (esbuild bundle, no Vite/Tailwind). It defines the token custom
properties it uses directly (real resolved values); token parity itself is guaranteed by Layer 1,
so this harness only needs to prove the swap doesn't change output *given identical inputs*.

## Run

```bash
pnpm test:computed-style     # build + L2
pnpm test:visual             # build + L3
pnpm test:visual:all         # both
pnpm test:visual:update      # re-capture baselines (a deliberate, reviewed act — §8)
```

Chromium is the pre-installed browser at `/opt/pw-browsers` (do **not** run `playwright install`);
`playwright.config.ts` points `executablePath` at it (override with `PW_CHROMIUM`).

## Files

- `harness/fixtures.tsx` — the frozen fixtures (source of truth for what's rendered).
- `harness/entry.tsx` + `harness/harness.css` — mounts every fixture in a labeled stage.
- `fixture-names.ts` — React-free name list for test collection (a drift test asserts the DOM
  matches it).
- `build.mjs` / `serve.mjs` — esbuild bundler + static server for the Playwright webServer.
- `audited-properties.ts` / `extract-computed-styles.ts` — the L2 property set + in-page walker.
- `__computed__/` + `__screenshots__/` — **committed baselines**. Update only via
  `pnpm test:visual:update` in a reviewed PR.
