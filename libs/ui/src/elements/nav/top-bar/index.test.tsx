import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.top-bar*` BEM classNames.
import { TopBar } from './index'

describe('TopBar', () => {
  it('renders a header element', () => {
    render(<TopBar />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('is a space-between bar of $12 height with a bottom border', () => {
    render(<TopBar data-testid="topbar" />)
    expect(screen.getByTestId('topbar')).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_height-c-size-12',
      '_borderBottomWidth-1px', '_backgroundColor-background',
    )
  })

  it('renders a truncating title when provided', () => {
    render(<TopBar title="My Studio" />)
    const title = screen.getByText('My Studio')
    expect(title).toHaveClass('_ox-hidden', '_ws-nowrap')
  })

  it('renders actions when provided', () => {
    render(<TopBar actions={<button>Save</button>} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('renders children', () => {
    render(<TopBar><span>Extra</span></TopBar>)
    expect(screen.getByText('Extra')).toBeInTheDocument()
  })
})
