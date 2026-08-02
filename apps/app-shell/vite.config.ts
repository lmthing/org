import { createViteConfig } from '@lmthing/utils/vite'

/**
 * AppHost — the prebuilt view-spec shell.
 *
 * `tailwind: false` — AppHost's vocabulary is closed Tamagui (`Prim.*` via the shared
 * ViewRenderer). It authors NO utility classNames and has no Tailwind directives, so the
 * plugin has nothing to compile and the `@tailwindcss/vite` peer dependency is not needed
 * at all (the factory loads it lazily, inside the `tailwind: true` branch we do not take).
 *
 * `router: false` — AppHost owns its OWN History-based router: it reads the project id +
 * client path from `window.location`, matches the path against the fetched view specs with
 * the PURE matcher (`@lmthing/ui/view/router`), and navigates via `history.pushState`. The
 * factory's Tanstack file-router has no `src/routes` directory to walk here.
 *
 * The factory includes `tamaguiConfigGuardPlugin` — load-bearing: every `Prim.*` primitive
 * calls `useTheme()`/`getConfig()`, which throws `Err0` unless `createTamagui()` ran as a
 * retained side-effect. `UiThemeProvider` imports `tamaguiConfig` as a VALUE (a use no
 * bundler may elide), so the guard passes; do NOT bypass the factory.
 */
export default createViteConfig(__dirname, undefined, { tailwind: false, router: false })
