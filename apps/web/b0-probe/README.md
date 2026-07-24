# Tamagui migration probes — B0 (coexistence) + B2 (migration rules)

> This dir now hosts two reproducible proofs: the original B0 spike (below) and the B2
> migration-rule proof. **B2:** `main.tsx` renders `lay-ref-*` (plain Tailwind flex divs) next to
> `lay-cand-*` (migrated Tamagui `Row`/`Col` with the class-vs-prop split), and
> `measure-layout.mjs` asserts both match 9/9 box-model props — verifying the exact codemod rules
> (`items-*`/`flex-1`/`min-w-*` → props; `justify-*`/`gap-*` → keep className). Run:
> `node ../node_modules/vite/bin/vite.js build --config vite.config.mts && node measure-layout.mjs`.
> See `docs/react-native-tamagui-migration.md` Part III / "B2 — codemod rules, EMPIRICALLY VERIFIED".
>
> **B2 surface slice (real component, real theme.css):** `surface.html` / `surface-main.tsx` render
> the REAL chat `EmptyState` (reference, Tailwind) next to `EmptyStateCandidate.tsx` (migrated to
> Tamagui `Row`/`Col`), both under the compiled `@lmthing/css/theme.css`. `measure-surface.mjs` walks
> both subtrees and asserts computed-style parity — **all 9 nodes match**. Surfaced one extra rule:
> a migrated container carrying a `text-{size}` class must restore its line-height via inline `style`
> (`.is_View` imposes `line-height`, and `lineHeight` is not a Tamagui View style prop). Run:
> `node ../node_modules/vite/bin/vite.js build --config surface.vite.config.mts && node measure-surface.mjs`.

---

# B0 probe — "does a Tailwind className win over Tamagui with the compiler?"

Throwaway spike for **Part III / B0** of `docs/react-native-tamagui-migration.md`. It builds four
`styled(@tamagui/core View)` components through the **real Tamagui optimizing compiler**
(`@tamagui/vite-plugin`, extraction ON) alongside `@tailwindcss/vite`, each given a Tailwind class
that conflicts with a Tamagui box-model value, then measures `getComputedStyle` in the pre-installed
Chromium.

## Result (see the doc for the full write-up)

**Tamagui wins every box-model conflict — className does NOT coexist.** Tamagui's `.is_View` base
rule is injected **unlayered** and so beats Tailwind's `@layer utilities`; explicit props additionally
get a hard-coded `:root` specificity boost (`@tamagui/web` `getCSSStylesAtomic.mjs:140`). This makes
Option B a *maximal* migration (surfaces drop Tailwind layout). Decision re-opened with the user.

## Reproduce

`node_modules/` and `dist/` are gitignored. Recreate the local resolution symlinks the Tamagui
static compiler needs (it bundles the config in a separate esbuild pass that ignores Vite aliases),
then build + measure:

```sh
cd apps/web/b0-probe
mkdir -p node_modules/@tamagui
ln -sfn ../../../../libs/ui/node_modules/@tamagui/core node_modules/@tamagui/core
ln -sfn "$(node -e "console.log(require.resolve('react/package.json').replace(/\/package.json$/,''))")" node_modules/react   # react 19 copy
ln -sfn "$(node -e "console.log(require.resolve('react-dom/package.json').replace(/\/package.json$/,''))")" node_modules/react-dom
node ../node_modules/vite/bin/vite.js build --config vite.config.mts
node measure.mjs   # prints the computed-style table; inspect.mjs dumps class/style attrs
```
