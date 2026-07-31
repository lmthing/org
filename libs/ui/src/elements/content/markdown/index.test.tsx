import { render } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Markdown } from './index'

/**
 * The web marker has to be asked for explicitly.
 *
 * `preflight.css:96` resets `list-style: none` on every `ol`/`ul`, and this renderer used to leave
 * the browser "on its own native marker" on web — which preflight had already taken away. The
 * result was that EVERY markdown list in the web app rendered with no bullet and no number: a
 * numbered list read as four unlabelled indented lines, in the chat transcript, in team messages,
 * everywhere `display()` produces a list.
 *
 * Nothing could see it. The text is all present in the DOM and in the accessibility tree, so no
 * query fails; jsdom has no marker box to measure. It took a screenshot to notice, so what this
 * test pins is the one machine-checkable trace of the fix — that the element carries a marker
 * style at all. It cannot prove a marker is PAINTED; `pnpm shots` is what looks.
 *
 * `list-style` has no React Native equivalent, so it is not in Tamagui's prop set and must go
 * through `style` — a `listStyleType` PROP is silently dropped. That is why this asserts on the
 * inline style rather than on a class.
 */
describe('Markdown lists carry a web marker', () => {
  it('numbers an ordered list', () => {
    const { container } = render(<Markdown source={'1. first\n2. second\n'} />)
    const ol = container.querySelector('ol')
    expect(ol).not.toBeNull()
    expect(ol!.style.listStyleType).toBe('decimal')
  })

  it('bullets an unordered list', () => {
    const { container } = render(<Markdown source={'- alpha\n- beta\n'} />)
    const ul = container.querySelector('ul')
    expect(ul).not.toBeNull()
    expect(ul!.style.listStyleType).toBe('disc')
  })

  it('puts the marker outside the text box, so wrapped lines stay aligned', () => {
    const { container } = render(<Markdown source={'- alpha\n'} />)
    expect(container.querySelector('ul')!.style.listStylePosition).toBe('outside')
  })
})
