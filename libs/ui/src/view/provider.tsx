/**
 * `ViewThemeProvider` — the theme context every `Prim.*` primitive requires.
 *
 * **Why this exists (found by the T1 golden-app migration, not by a test).** The renderer is
 * built on `Prim.*`, which are real Tamagui components, and every one of them calls `useTheme()`.
 * Outside a provider that throws `Missing theme.` — so a generated view wrapper that renders a
 * bare `<ViewRenderer/>` produces the page-level error boundary on EVERY route.
 *
 * Nothing could catch that upstream: the unified web SPA wraps its own `TamaguiProvider` at
 * `apps/web/src/routes/__root.tsx`, the mobile app wraps one at its root, and the renderer's
 * jsdom suite renders through `../test-utils`, which wraps one too. A **project-app page bundle**
 * has no such root — its entry mounts the page component directly — which is exactly the
 * configuration no existing harness exercises.
 *
 * It is a distinct export rather than something `ViewRenderer` mounts itself because the native
 * host already has a provider and nesting a second one would re-root its theme. The web wrapper
 * (`@lmthing/cli` `app/view-spec/wrapper.ts`) is the one delivery path that owns no root, so it
 * is the one that mounts this.
 *
 * The config injects NO colour variables — `theme.css` keeps full control of theming through
 * `data-theme` and the space `--lm-*` overrides. See `../theme/tamagui.config`.
 */

import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiConfig } from '../theme/tamagui.config'

/** Wrap a spec page in the theme context `Prim.*` needs. Idempotent to render, cheap to mount. */
export function ViewThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="app">
      {children}
    </TamaguiProvider>
  )
}
