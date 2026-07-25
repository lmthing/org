import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { EmptyState } from './EmptyState'

/**
 * EmptyState — post-Tamagui-migration behavior (Part III / B2).
 *
 * The Phase-0 byte-identity golden is gone by construction: EmptyState now renders on Tamagui
 * `Row`/`Col`, which add their own atomic classes. Computed-style/visual PARITY vs the pre-migration
 * render is proven separately and exactly by `apps/web/b0-probe/measure-surface.mjs` (all 9 nodes
 * match under the real theme.css). This suite keeps the structural + prop-conditional contract.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

describe('EmptyState — structure + conditional rendering', () => {
  it('renders the heading (with project name), body, and one button per suggestion', () => {
    const { container, getByText } = render(
      <P>
        <EmptyState projectName="Acme" onSuggestion={() => {}} className="extra" />
      </P>,
    )
    expect(getByText('How can I help in Acme?')).toBeTruthy()
    expect(container.querySelector('h1')?.textContent).toBe('How can I help in Acme?')
    expect(container.querySelector('p')).not.toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(4)
    // The caller's className is merged onto the outer container.
    expect(container.querySelector('.extra')).not.toBeNull()
  })

  it('omits the suggestion row and project name when those props are absent', () => {
    const { container } = render(
      <P>
        <EmptyState />
      </P>,
    )
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('h1')?.textContent).toBe('How can I help?')
    expect(container.querySelector('p')).not.toBeNull()
  })
})
