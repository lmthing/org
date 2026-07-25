import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'
import {
  Box,
  Text,
  Pressable,
  Row,
  Col,
  Image,
  Link,
  Form,
  List,
  ListItem,
  TextField,
  TextArea,
  Select,
  Option,
  Audio,
  IFrame,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Svg,
  Path,
  Pre,
  Br,
  Hr,
} from './index'

/**
 * Phase-0 parity: each vocabulary primitive is a PURE PASSTHROUGH wrapper — it must emit the
 * exact same tag with the exact same props/className as the raw host tag it replaces, so the
 * de-HTML refactor produces byte-identical HTML (the strongest parity story; §1.5). These
 * tests are the in-isolation proof the plan's Appendix step 2 calls for.
 */

/** Render markup and return the container's innerHTML (the serialized DOM). */
const html = (node: React.ReactElement) => render(node).container.innerHTML

describe('Phase-0 primitives — byte-identical passthrough', () => {
  // Part III: Box (B3.3), Text (B3.1), Pressable (B3.2) are real Tamagui primitives now. They render
  // the real host tag and pass DOM props through, but Tamagui adds its own atomic classes, so we assert
  // the DOM tag + prop/child passthrough — NOT byte-identity (broken by construction). Exact
  // computed-style parity vs raw tags is proven under real theme.css+preflight in the b0-probe slices.
  const withProvider = (node: React.ReactNode) =>
    render(<TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">{node}</TamaguiProvider>)

  it('Box renders a <div> by default and semantic tags via `as`, keeping DOM props + children', () => {
    const el = withProvider(<Box id="x" className="a b" role="group" data-k="1" title="t">hi</Box>)
      .container.querySelector('[data-k]')!
    expect(el.tagName).toBe('DIV')
    expect(el.className).toContain('a')
    expect(el.getAttribute('role')).toBe('group')
    expect(el.textContent).toBe('hi')
    for (const as of ['section', 'nav', 'header', 'footer', 'aside', 'article', 'main'] as const) {
      const s = withProvider(<Box as={as} data-t={as}>c</Box>).container.querySelector(`[data-t="${as}"]`)!
      expect(s.tagName).toBe(as.toUpperCase())
    }
  })

  it('Text renders <span> by default and <p> when block, keeping className + children', () => {
    const span = withProvider(<Text className="t" data-x="1">hi</Text>).container.querySelector('[data-x]')!
    expect(span.tagName).toBe('SPAN')
    expect(span.className).toContain('t')
    expect(span.textContent).toBe('hi')
    const p = withProvider(<Text block className="t" data-y="2">hi</Text>).container.querySelector('[data-y]')!
    expect(p.tagName).toBe('P')
  })

  it('Text renders inline tags via `as` (strong/em/small/code/label), keeping htmlFor + children', () => {
    for (const as of ['strong', 'em', 'small', 'code'] as const) {
      const el = withProvider(<Text as={as} data-t={as}>x</Text>).container.querySelector(`[data-t="${as}"]`)!
      expect(el.tagName).toBe(as.toUpperCase())
      expect(el.textContent).toBe('x')
    }
    const label = withProvider(<Text as="label" htmlFor="f" data-l="1">L</Text>).container.querySelector('[data-l]')!
    expect(label.tagName).toBe('LABEL')
    expect(label.getAttribute('for')).toBe('f')
  })

  it('Text renders heading tags via `as` (h1–h6), keeping className', () => {
    for (const as of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      const el = withProvider(<Text as={as} className="h" data-h={as}>t</Text>).container.querySelector(`[data-h="${as}"]`)!
      expect(el.tagName).toBe(as.toUpperCase())
      expect(el.className).toContain('h')
    }
  })

  // Part III / B3.2: Pressable is now a real Tamagui primitive (per-tag `createComponent`, `isText`).
  // It renders the real `<button>`/`<a>`/`<div>` (tag runtime-guaranteed) and passes DOM props through;
  // computed-style parity vs the raw tag is proven in apps/web/b0-probe/pressable-variants.mjs.
  it('Pressable renders <button> by default and <a>/<div> via `as`, keeping DOM props + children', () => {
    const btn = withProvider(<Pressable className="b" disabled title="t" data-x="1">go</Pressable>)
      .container.querySelector('[data-x]')!
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.className).toContain('b')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.textContent).toBe('go')
    const a = withProvider(<Pressable as="a" href="/x" data-x="2">go</Pressable>).container.querySelector('[data-x]')!
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe('/x')
    const div = withProvider(<Pressable as="div" role="button" data-x="3">go</Pressable>).container.querySelector('[data-x]')!
    expect(div.tagName).toBe('DIV')
    expect(div.getAttribute('role')).toBe('button')
  })

  it('Pressable adds NO type attribute by default (matches a raw <button>)', () => {
    const el = withProvider(<Pressable data-x="1">x</Pressable>).container.querySelector('[data-x]')!
    expect(el.tagName).toBe('BUTTON')
    expect(el.hasAttribute('type')).toBe(false)
  })

  it('Row and Col are Tamagui primitives that render a <div>, keep className + data-* + children', () => {
    // Part III / B2: Row/Col are now real Tamagui styled(View). On web they render a <div>; Tamagui
    // adds its own atomic classes, so we assert the DOM element/tag + that the caller's className,
    // data-attrs and children pass through (not byte-identity, which Tamagui breaks by construction).
    const P = ({ children }: { children: React.ReactNode }) => (
      <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">{children}</TamaguiProvider>
    )
    const row = render(<P><Row className="r" data-x="1">c</Row></P>).container.querySelector('div[data-x]')!
    expect(row.tagName).toBe('DIV')
    expect(row.className).toContain('r')
    expect(row.getAttribute('data-x')).toBe('1')
    expect(row.textContent).toBe('c')
    const col = render(<P><Col className="cc" data-y="2">c</Col></P>).container.querySelector('div[data-y]')!
    expect(col.tagName).toBe('DIV')
    expect(col.className).toContain('cc')
    expect(col.getAttribute('data-y')).toBe('2')
  })

  // Image is Tamagui now (per-tag `createComponent`), because the P3 codemod treats it as a
  // style-prop target and a host `<img>` silently dropped those props as unknown DOM attributes.
  // It renders the real `<img>` and passes DOM props through; byte-identity no longer holds
  // (Tamagui adds its base classes), so assert the tag + props + that style props actually apply.
  it('Image renders a real <img>, keeps DOM props, and applies style props', () => {
    const el = withProvider(
      <Image src="/a.png" alt="a" className="i" width="$5" height="$5" objectFit="cover" />,
    ).container.querySelector('img')!
    expect(el.tagName).toBe('IMG')
    expect(el.getAttribute('src')).toBe('/a.png')
    expect(el.getAttribute('alt')).toBe('a')
    expect(el).toHaveClass('i', '_width-c-size-5', '_height-c-size-5')
    expect(el.style.objectFit).toBe('cover')
    // the `$token` must NOT leak to the DOM as a width/height attribute
    expect(el.getAttribute('width')).toBeNull()
  })

  // Part III B3.4-leaf: Link/Form/List/ListItem are real Tamagui primitives now — assert the DOM tag +
  // prop passthrough (not byte-identity). Computed parity proven under real CSS in the b0-probe slices.
  it('Link renders <a>, keeping href/DOM props + children', () => {
    const a = withProvider(<Link href="/x" target="_blank" rel="noreferrer" className="l" data-x="1">go</Link>)
      .container.querySelector('[data-x]')!
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe('/x')
    expect(a.className).toContain('l')
    expect(a.textContent).toBe('go')
  })

  it('Form renders <form>, keeping method/DOM props', () => {
    const f = withProvider(<Form className="f" method="post" data-x="1">c</Form>).container.querySelector('[data-x]')!
    expect(f.tagName).toBe('FORM')
    expect(f.getAttribute('method')).toBe('post')
  })

  it('List renders <ul>/<ol> and ListItem renders <li>', () => {
    expect(withProvider(<List data-x="1">c</List>).container.querySelector('[data-x]')!.tagName).toBe('UL')
    expect(withProvider(<List ordered data-x="2">c</List>).container.querySelector('[data-x]')!.tagName).toBe('OL')
    const li = withProvider(<ListItem className="li" data-i="1">c</ListItem>).container.querySelector('[data-i]')!
    expect(li.tagName).toBe('LI')
    expect(li.className).toContain('li')
  })

  // Form controls are Tamagui now (P4 — createComponent per tag, so `elements/forms/*` can carry
  // design tokens as style PROPS instead of a BEM className). They therefore need the provider and
  // no longer emit byte-identical HTML — they gain Tamagui's base classes. What must still hold is
  // the part the surfaces depend on: the REAL host tag, and every DOM prop passed through untouched.
  it('form controls emit the real input/textarea/select tag with their DOM props intact', () => {
    const field = withProvider(
      <TextField type="text" className="i" placeholder="p" defaultValue="v" />,
    ).container.querySelector('input')!
    expect(field.tagName).toBe('INPUT')
    expect(field.type).toBe('text')
    expect(field.placeholder).toBe('p')
    expect(field.value).toBe('v')
    expect(field).toHaveClass('i')

    const area = withProvider(
      <TextArea className="t" rows={3} defaultValue="v" />,
    ).container.querySelector('textarea')!
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.rows).toBe(3)
    expect(area.value).toBe('v')
    expect(area).toHaveClass('t')

    const select = withProvider(
      <Select className="s" defaultValue="a"><Option value="a">A</Option></Select>,
    ).container.querySelector('select')!
    expect(select.tagName).toBe('SELECT')
    expect(select.value).toBe('a')
    expect(select).toHaveClass('s')
    // `<option>` stays a pure host passthrough: a real classless <option> inside the select.
    const option = select.querySelector('option')!
    expect(option.tagName).toBe('OPTION')
    expect(option.value).toBe('a')
    expect(option.textContent).toBe('A')
    expect(option.className).toBe('')
  })

  it('media + misc + table primitives emit their tags verbatim', () => {
    expect(html(<Audio controls src="/a.mp3" className="a" />)).toBe(
      html(<audio controls src="/a.mp3" className="a" />),
    )
    expect(html(<IFrame src="/x" title="t" className="f" />)).toBe(
      html(<iframe src="/x" title="t" className="f" />),
    )
    expect(html(<Pre className="p">x</Pre>)).toBe(html(<pre className="p">x</pre>))
    expect(html(<Br />)).toBe(html(<br />))
    expect(html(<Hr className="h" />)).toBe(html(<hr className="h" />))
    expect(
      html(
        <Table className="t"><Thead><Tr><Th>H</Th></Tr></Thead><Tbody><Tr><Td>D</Td></Tr></Tbody></Table>,
      ),
    ).toBe(
      html(
        <table className="t"><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>,
      ),
    )
  })

  it('svg primitives emit svg/path verbatim (react-native-svg-compatible names)', () => {
    expect(
      html(
        <Svg width="13" height="13" viewBox="0 0 24 24" className="ic">
          <Path d="M5 15H4" strokeWidth="2" />
        </Svg>,
      ),
    ).toBe(
      html(
        <svg width="13" height="13" viewBox="0 0 24 24" className="ic">
          <path d="M5 15H4" strokeWidth="2" />
        </svg>,
      ),
    )
  })

  it('primitives forward refs to their host node (drop-in for ref-bearing tags)', () => {
    const boxRef = React.createRef<HTMLElement>()
    // Box is Tamagui now → needs the provider; it still forwards its ref to the host <div>.
    withProvider(<Box ref={boxRef as React.Ref<HTMLElement>}>x</Box>)
    expect(boxRef.current?.tagName).toBe('DIV')

    const inputRef = React.createRef<HTMLInputElement>()
    // TextField is Tamagui now → needs the provider; it still forwards its ref to the host <input>.
    withProvider(<TextField ref={inputRef} defaultValue="v" />)
    expect(inputRef.current?.tagName).toBe('INPUT')

    const btnRef = React.createRef<HTMLButtonElement>()
    // Pressable is Tamagui now → needs the provider; it still forwards its ref to the host <button>.
    withProvider(<Pressable ref={btnRef as React.Ref<HTMLElement>}>x</Pressable>)
    expect(btnRef.current?.tagName).toBe('BUTTON')

    const taRef = React.createRef<HTMLTextAreaElement>()
    // TextArea is Tamagui now → needs the provider; it still forwards its ref to the host <textarea>.
    withProvider(<TextArea ref={taRef} defaultValue="v" />)
    expect(taRef.current?.tagName).toBe('TEXTAREA')
  })
})
