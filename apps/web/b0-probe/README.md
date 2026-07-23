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
