import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { AppFrame } from './AppView'

/**
 * The chat surface's main pane renders the project's SERVED APP inline — the whole of "select a
 * project and it starts as a chat, then grows". On web that is an `<iframe>` at the pod's own
 * `/app/<project>/` mount.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const frameSrc = (c: HTMLElement) => c.querySelector('iframe')?.getAttribute('src') ?? ''

describe('AppFrame', () => {
  it('frames the pod app mount for the selected project (home by default)', () => {
    const { container } = render(
      <P>
        <AppFrame projectId="my-todos" />
      </P>,
    )
    const src = frameSrc(container)
    expect(src).toContain('/app/my-todos/')
  })

  it('frames a specific page route when one is given', () => {
    const { container } = render(
      <P>
        <AppFrame projectId="trip" routePath="/expenses" />
      </P>,
    )
    expect(frameSrc(container)).toContain('/app/trip/expenses')
  })
})
