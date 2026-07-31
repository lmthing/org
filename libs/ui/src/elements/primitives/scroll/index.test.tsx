import { render } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Scroll } from './index'

/**
 * `stickToEnd` promises the region is pinned to its END. Scrolling was only ever half of that:
 * when the content is SHORTER than the box there is nothing to scroll, and every transcript in the
 * app sat at the top with a void between the last message and the composer.
 *
 * Two things are pinned here, and the second matters more than it looks:
 *
 *  - the region declares itself a flex column. It computed to `display: block` before, which made
 *    both the spacer and any `gap` the caller passed inert — the team transcript was already
 *    asking for `flexDirection="column" gap="$4"` and silently getting neither.
 *  - the bottom-anchoring is a growing SPACER, not `justify-content: flex-end` on the box.
 *    End-alignment in a scroll container makes overflow unreachable in the start direction, i.e.
 *    you cannot scroll back to the first message. jsdom does no layout, so it cannot prove the
 *    reachability half — `apps/web/tests/surface-shots/shoot.mjs` scrolls a deliberately
 *    overflowing transcript to the top and checks the first message is still in view.
 *
 * Asserted on Tamagui's atomic classNames because that is how it emits style here: there is no
 * inline `style` to read, and jsdom resolves none of these rules for `getComputedStyle`.
 */
function regionOf(container: HTMLElement): HTMLElement {
  // The provider wraps the tree in display:contents spans; the region is the first real div.
  const el = container.querySelector('div')
  if (!el) throw new Error('no region rendered')
  return el
}

describe('Scroll stickToEnd', () => {
  it('makes the region a flex column so gap and the spacer mean something', () => {
    const { container } = render(
      <Scroll stickToEnd>
        <div>message</div>
      </Scroll>,
    )
    const region = regionOf(container)
    expect(region.className).toContain('_dsp-flex')
    expect(region.className).toContain('_fd-column')
  })

  it('puts a growing spacer ABOVE the content, so short content sits at the bottom', () => {
    const { container } = render(
      <Scroll stickToEnd>
        <div data-testid="content">message</div>
      </Scroll>,
    )
    const region = regionOf(container)
    const first = region.children[0] as HTMLElement
    // The spacer, not the caller's content — order is the whole mechanism.
    expect(first.getAttribute('data-testid')).toBeNull()
    expect(first.className).toContain('_flexGrow-1')
    // Zero basis and no shrink: it takes only FREE space, and collapses to nothing the moment the
    // transcript overflows — which is what leaves the long case behaving exactly as before.
    expect(first.className).toContain('_fb-0px')
    expect(first.className).toContain('_flexShrink-0')
    expect((region.children[1] as HTMLElement).getAttribute('data-testid')).toBe('content')
  })

  it('adds nothing at all without stickToEnd', () => {
    const { container } = render(
      <Scroll>
        <div data-testid="content">message</div>
      </Scroll>,
    )
    const region = regionOf(container)
    expect(region.children).toHaveLength(1)
    expect((region.children[0] as HTMLElement).getAttribute('data-testid')).toBe('content')
  })
})
