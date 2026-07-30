/**
 * `UiThemeProvider` — the theme context every `Prim.*` primitive requires.
 *
 * **Any host that renders a `@lmthing/ui` component must mount this at its root.** The element
 * catalogue is built on `Prim.*`, which are real Tamagui components, and every one of them calls
 * `useTheme()`. Outside a provider that throws `Missing theme.`, which surfaces as the page-level
 * error boundary on EVERY route — not as a degraded style.
 *
 * Two distinct failures hide behind that one symptom, and mounting this fixes both:
 *
 *  - **`Err0` (no config).** `createTamagui()` has to actually be in the bundle. Importing a
 *    primitive is not enough on its own — see the "Import discipline" note in `./tamagui.config`.
 *    This provider takes `tamaguiConfig` as a VALUE, which is a use no bundler can elide.
 *  - **`Missing theme.`** — the context itself, which is what `TamaguiProvider` supplies.
 *
 * The config injects NO colour variables — `theme.css` keeps full control of theming through
 * `data-theme` and the space `--lm-*` overrides. See `./tamagui.config`.
 *
 * Hosts that mount their own `TamaguiProvider` (the unified web SPA at
 * `apps/web/src/routes/__root.tsx`, the mobile app at its root) must NOT also mount this — nesting a
 * second provider re-roots the theme. The standalone SPAs (com, org, social, casa, store, space) and
 * the generated project-app page wrapper own no such root, so they are the ones that mount it. The
 * wrapper reaches it under its historical name, `ViewThemeProvider` (`../view/provider`).
 */

import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiConfig } from './tamagui.config'

/** Wrap an app root in the theme context `Prim.*` needs. Idempotent to render, cheap to mount. */
export function UiThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="app">
      {children}
    </TamaguiProvider>
  )
}
