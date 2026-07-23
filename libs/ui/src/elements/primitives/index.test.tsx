import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Box, Text, Pressable, Row, Col, Image, Link, Form, List, ListItem } from './index.ts'

/**
 * Phase-0 parity: each vocabulary primitive is a PURE PASSTHROUGH wrapper — it must emit the
 * exact same tag with the exact same props/className as the raw host tag it replaces, so the
 * de-HTML refactor produces byte-identical HTML (the strongest parity story; §1.5). These
 * tests are the in-isolation proof the plan's Appendix step 2 calls for.
 */

/** Render markup and return the container's innerHTML (the serialized DOM). */
const html = (node: React.ReactElement) => render(node).container.innerHTML

describe('Phase-0 primitives — byte-identical passthrough', () => {
  it('Box emits a plain <div> with props verbatim, matching a raw <div>', () => {
    const props = { id: 'x', className: 'a b', role: 'group', 'data-k': '1', title: 't' } as const
    expect(html(<Box {...props}>hi</Box>)).toBe(html(<div {...props}>hi</div>))
  })

  it('Box adds NO class attribute when none is passed (pure passthrough)', () => {
    const { container } = render(<Box>hi</Box>)
    const el = container.firstElementChild!
    expect(el.tagName).toBe('DIV')
    expect(el.hasAttribute('class')).toBe(false)
  })

  it('Box renders semantic tags via `as`', () => {
    for (const as of ['section', 'nav', 'header', 'footer', 'aside', 'article', 'main'] as const) {
      const { container } = render(<Box as={as}>c</Box>)
      expect(container.firstElementChild!.tagName).toBe(as.toUpperCase())
    }
    expect(html(<Box as="section" className="s">c</Box>)).toBe(html(<section className="s">c</section>))
  })

  it('Text emits <span> by default and <p> when block, matching raw tags', () => {
    expect(html(<Text className="t">hi</Text>)).toBe(html(<span className="t">hi</span>))
    expect(html(<Text block className="t">hi</Text>)).toBe(html(<p className="t">hi</p>))
  })

  it('Text renders inline tags via `as` (strong/em/small/label/code)', () => {
    expect(html(<Text as="strong">b</Text>)).toBe(html(<strong>b</strong>))
    expect(html(<Text as="em">i</Text>)).toBe(html(<em>i</em>))
    expect(html(<Text as="small">s</Text>)).toBe(html(<small>s</small>))
    expect(html(<Text as="code">c</Text>)).toBe(html(<code>c</code>))
    expect(html(<Text as="label" htmlFor="f">L</Text>)).toBe(html(<label htmlFor="f">L</label>))
  })

  it('Text renders heading tags via `as` (h1–h6)', () => {
    for (const as of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      expect(html(<Text as={as} className="h">t</Text>)).toBe(
        html(<Text as={as} className="h">t</Text>),
      )
      const { container } = render(<Text as={as}>t</Text>)
      expect(container.firstElementChild!.tagName).toBe(as.toUpperCase())
    }
    expect(html(<Text as="h1" className="title">t</Text>)).toBe(html(<h1 className="title">t</h1>))
  })

  it('Pressable emits <button> by default and <a>/<div> via `as`, matching raw tags', () => {
    const btn = { className: 'b', disabled: true, title: 't' } as const
    expect(html(<Pressable {...btn}>go</Pressable>)).toBe(html(<button {...btn}>go</button>))
    expect(html(<Pressable as="a" href="/x" className="l">go</Pressable>)).toBe(
      html(<a href="/x" className="l">go</a>),
    )
    expect(html(<Pressable as="div" role="button" className="d">go</Pressable>)).toBe(
      html(<div role="button" className="d">go</div>),
    )
  })

  it('Pressable adds NO type attribute by default (matches a raw <button>)', () => {
    const el = render(<Pressable>x</Pressable>).container.firstElementChild!
    expect(el.tagName).toBe('BUTTON')
    expect(el.hasAttribute('type')).toBe(false)
  })

  it('Row and Col emit a plain <div> (identical DOM to Box in Phase 0)', () => {
    expect(html(<Row className="r" data-x="1">c</Row>)).toBe(html(<div className="r" data-x="1">c</div>))
    expect(html(<Col className="c" data-y="2">c</Col>)).toBe(html(<div className="c" data-y="2">c</div>))
  })

  it('Image emits <img> verbatim', () => {
    const props = { src: '/a.png', alt: 'a', width: 10, height: 10, className: 'i' } as const
    expect(html(<Image {...props} />)).toBe(html(<img {...props} />))
  })

  it('Link emits <a> verbatim', () => {
    const props = { href: '/x', target: '_blank', rel: 'noreferrer', className: 'l' } as const
    expect(html(<Link {...props}>go</Link>)).toBe(html(<a {...props}>go</a>))
  })

  it('Form emits <form> verbatim', () => {
    expect(html(<Form className="f" method="post">c</Form>)).toBe(
      html(<form className="f" method="post">c</form>),
    )
  })

  it('List emits <ul>/<ol> and ListItem emits <li>, matching raw tags', () => {
    expect(html(<List className="l">c</List>)).toBe(html(<ul className="l">c</ul>))
    expect(html(<List ordered className="l">c</List>)).toBe(html(<ol className="l">c</ol>))
    expect(html(<ListItem className="li" data-i="1">c</ListItem>)).toBe(
      html(<li className="li" data-i="1">c</li>),
    )
  })
})
