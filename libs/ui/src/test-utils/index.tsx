import * as React from 'react'
import {
  render as rtlRender,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../theme/tamagui-web.config'

/**
 * Test render for the SHIPPED element layer (`elements/**` `index.test.tsx`).
 *
 * Post-swap an element renders `Prim.*` — real Tamagui `createComponent` host tags — instead of a
 * plain host tag with BEM classNames, and every Tamagui component calls `useTheme()`, which throws
 * `Missing theme.` outside a provider. That is the whole reason those suites sat outside the vitest
 * include: they exercise the component the app actually ships, and it now needs the same provider
 * the `*-styled.test.tsx` proofs already wrap themselves in.
 *
 * The re-export shape mirrors `@testing-library/react` so a suite only changes its import
 * specifier. Names are re-exported EXPLICITLY (not `export *`) because a star re-export of
 * `@testing-library/react` would pull in its own unwrapped `render` and shadow this one.
 *
 * See docs/tamagui-idiomatic-migration.md §4/§6.
 */
export const TamaguiTestProvider = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** `@testing-library/react`'s `render`, wrapped in the Tamagui provider the primitives require. */
export function render(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return rtlRender(ui, { wrapper: TamaguiTestProvider, ...options })
}

export {
  screen,
  fireEvent,
  waitFor,
  waitForElementToBeRemoved,
  within,
  cleanup,
  act,
  renderHook,
} from '@testing-library/react'
export type { RenderOptions, RenderResult } from '@testing-library/react'
