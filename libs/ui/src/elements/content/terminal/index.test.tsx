import { render } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Terminal } from './index.web'

/**
 * The shipped web `Terminal`. Replaces the deleted `terminal-styled.test.tsx`, which gated a
 * parallel `styled()` copy nothing imported. `Terminal` forwards only `className` (not arbitrary
 * DOM props), so the frame is found by that. See docs/tamagui-idiomatic-migration.md §4/§6.
 */
describe('Terminal (web)', () => {
  const frame = (session: null | object) =>
    render(<Terminal session={session as never} className="probe" />).container
      .querySelector('.probe')!

  it('the frame is a full-size column surface — the former `.terminal`', () => {
    expect(frame(null)).toHaveClass(
      '_dsp-flex', '_fd-column', '_ox-hidden', '_oy-hidden', '_backgroundColor-background',
    )
  })

  it('centres its content while there is no session, and stops once one attaches', () => {
    expect(frame(null)).toHaveClass('_alignItems-center', '_justifyContent-center')
    expect(frame({ id: 's' }).className).not.toMatch(/_justifyContent-center/)
  })

  it('the viewport child grows and may shrink below its content — the former `__viewport`', () => {
    const viewport = frame(null).firstElementChild!
    expect(viewport).toHaveClass('_flexGrow-1', '_flexShrink-1')
  })
})
