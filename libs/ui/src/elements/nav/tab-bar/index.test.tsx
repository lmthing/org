import { render, screen } from '../../../test-utils/index'
import { userEvent } from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.tab-bar*` BEM classNames.
import { TabBar } from './index'

const tabs = [
  { id: 'tab1', label: 'Tab 1' },
  { id: 'tab2', label: 'Tab 2' },
]

describe('TabBar', () => {
  it('renders all tabs as real buttons', () => {
    render(<TabBar tabs={tabs} />)
    expect(screen.getByRole('tab', { name: 'Tab 1' }).tagName).toBe('BUTTON')
    expect(screen.getByRole('tab', { name: 'Tab 2' })).toBeInTheDocument()
  })

  it('is a gapped row with a bottom border', () => {
    render(<TabBar tabs={tabs} data-testid="tabbar" />)
    expect(screen.getByTestId('tabbar')).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_gap-c-space-1', '_borderBottomWidth-1px',
    )
  })

  it('underlines only the active tab with the primary token', () => {
    render(<TabBar tabs={tabs} activeTab="tab1" />)
    expect(screen.getByRole('tab', { name: 'Tab 1' })).toHaveClass('_borderBottomColor-primary')
    expect(screen.getByRole('tab', { name: 'Tab 2' }).className)
      .not.toMatch(/_borderBottomColor-primary/)
  })

  it('calls onTabChange when a tab is clicked', async () => {
    const onTabChange = vi.fn()
    render(<TabBar tabs={tabs} onTabChange={onTabChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Tab 2' }))
    expect(onTabChange).toHaveBeenCalledWith('tab2')
  })
})
