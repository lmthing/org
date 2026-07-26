/**
 * The vocabulary primitives, RENDERED on the React Native target.
 *
 * `src/elements/primitives/native-forks.test.tsx` (jsdom) can only assert that the RN-independent
 * forks LOAD and export matching symbols — it imports `./box/index.native` by its explicit path,
 * which is not what Metro does, and it cannot touch the forks that import `react-native`,
 * `react-native-svg` or `react-native-webview` at all. Everything below is the other half: the
 * forks reached the way a device reaches them (through the barrel, Metro picking the fork), mounted
 * through the real React reconciler, asserted on the React Native element tree.
 *
 * The forks FORWARD Tamagui style props (`padding="$4"`) through `nativeSafeProps`, so one surface
 * prop styles both targets — asserted below for `Box`, `Text`, `Row`/`Col` and `TextField`. (This
 * comment used to say the opposite, describing the forks before `b49471d`; the styling half of the
 * §1c decision is closed, and the assertions here are what keeps it closed.)
 */
import * as React from 'react'
import { Linking } from 'react-native'
import { test, expect } from '../harness'
import {
  render,
  find,
  findByType,
  findTextInput,
  press,
  styleOf,
  flattenStyle,
  hostTypes,
  NATIVE_VIEW,
  NATIVE_TEXT,
  NATIVE_IMAGE,
} from '../render'
import {
  Box,
  Text,
  Row,
  Col,
  Pressable,
  Image,
  Link,
  List,
  ListItem,
  Form,
  TextField,
  TextArea,
  Select,
  Option,
  Table,
  Tr,
  Td,
  Pre,
  Br,
  Hr,
  Svg,
  Path,
  IFrame,
} from '../../src/elements/primitives'

test('Box mounts a native view', () => {
  const { tree } = render(<Box />)
  expect(findByType(tree, NATIVE_VIEW)).toBeTruthy()
})

test('Text mounts a native text node carrying its string child', () => {
  const { tree } = render(<Text>hello native</Text>)
  const text = findByType(tree, NATIVE_TEXT)
  expect(text).toBeTruthy()
  expect(text?.children).toEqual(['hello native'])
})

test('Row sets flexDirection: row on the native view', () => {
  const { tree } = render(<Row />)
  expect(styleOf(tree, NATIVE_VIEW).flexDirection).toBe('row')
})

test('Col sets flexDirection: column on the native view', () => {
  const { tree } = render(<Col />)
  expect(styleOf(tree, NATIVE_VIEW).flexDirection).toBe('column')
})

test('Pressable maps the web onClick onto a real native press', () => {
  let pressed = 0
  const { tree } = render(<Pressable onClick={() => pressed++} />)
  press(findByType(tree, NATIVE_VIEW))
  expect(pressed).toBe(1)
})

test('Pressable attaches no press responder when disabled', () => {
  const { tree } = render(<Pressable disabled onClick={() => {}} />)
  expect(findByType(tree, NATIVE_VIEW)?.props.onResponderRelease).toBe(undefined)
})

test('Image maps src → source.uri and alt → accessibilityLabel', () => {
  const { tree } = render(<Image src="https://example.test/a.png" alt="an example" />)
  const image = findByType(tree, NATIVE_IMAGE)
  expect(image).toBeTruthy()
  // RN normalises `source` to an array of sources before it reaches the native view.
  const sources = image?.props.source as { uri: string }[]
  expect(sources[0].uri).toBe('https://example.test/a.png')
  expect(image?.props.accessibilityLabel).toBe('an example')
})

test('Link is an accessible link that opens its href through RN Linking', () => {
  const openURL = Linking.openURL as unknown as { mock: { calls: unknown[][] }; mockClear(): void }
  openURL.mockClear()
  const { tree } = render(<Link href="https://lmthing.org">docs</Link>)
  const text = findByType(tree, NATIVE_TEXT)
  expect(text?.props.accessibilityRole).toBe('link')
  press(text)
  expect(openURL.mock.calls).toHaveLength(1)
  expect(openURL.mock.calls[0][0]).toBe('https://lmthing.org')
})

test('List and ListItem mount nested native views', () => {
  const { tree } = render(
    <List>
      <ListItem />
    </List>,
  )
  expect(hostTypes(tree).filter((t) => t === NATIVE_VIEW)).toHaveLength(2)
})

test('Form mounts a native view (there is no <form> on native)', () => {
  const { tree } = render(<Form />)
  expect(findByType(tree, NATIVE_VIEW)).toBeTruthy()
})

test('TextField mounts a text input; TextArea is the multiline one', () => {
  expect(findTextInput(render(<TextField />).tree)).toBeTruthy()
  expect(findTextInput(render(<TextArea />).tree)?.props.multiline).toBe(true)
})

test('TextField forwards Tamagui style props to the native input', () => {
  // The fork used to destructure `value`/`placeholder`/`onChange`/`style` and drop the rest, so
  // `Input`'s INPUT_BASE (height/border/radius/background/fontSize) never reached the device and
  // every field rendered as an unstyled system input. Nothing on web could see it.
  const input = findTextInput(render(<TextField height={36} borderWidth={1} fontSize={14} />).tree)
  const style = flattenStyle(input?.props?.style)
  expect(style.height).toBe(36)
  // Tamagui expands `borderWidth` into the four per-side properties on native.
  expect(style.borderTopWidth).toBe(1)
  // `fontSize` reaching STYLE rather than sitting on the node as a prop is the `isInput: true`
  // half — an RN TextInput ignores a `fontSize` prop, so this assertion is the whole reason to
  // know that flag exists.
  expect(style.fontSize).toBe(14)
})

test('type="password" becomes secureTextEntry, not a plain-text field', () => {
  // SettingsSchemaForm renders every integration API token with type="password". `type` means
  // nothing to an RN TextInput, so without the translation the token is displayed in the clear.
  expect(findTextInput(render(<TextField type="password" />).tree)?.props.secureTextEntry).toBe(true)
  expect(findTextInput(render(<TextField type="text" />).tree)?.props.secureTextEntry).toBe(undefined)
})

test('onChange is translated to onChangeText, keeping the web event shape', () => {
  let seen
  const input = findTextInput(render(<TextField onChange={(e) => (seen = e.target.value)} />).tree)
  input?.props.onChangeText('typed')
  expect(seen).toBe('typed')
})

test('disabled becomes editable={false}', () => {
  expect(findTextInput(render(<TextField disabled />).tree)?.props.editable).toBe(false)
})

test('Select falls back to rendering its options as text on native', () => {
  const { tree } = render(
    <Select>
      <Option>first</Option>
    </Select>,
  )
  expect(findByType(tree, NATIVE_VIEW)).toBeTruthy()
  expect(findByType(tree, NATIVE_TEXT)?.children).toEqual(['first'])
})

test('the table family mounts native views with the row laid out horizontally', () => {
  const { tree } = render(
    <Table>
      <Tr>
        <Td />
      </Tr>
    </Table>,
  )
  expect(hostTypes(tree).filter((t) => t === NATIVE_VIEW)).toHaveLength(3)
  const row = find(tree, (t) => t === NATIVE_VIEW)?.children?.[0]
  expect((row as { props: { style: Record<string, unknown> } }).props.style.flexDirection).toBe('row')
})

test('Pre mounts a text node; Br and Hr degrade correctly on native', () => {
  expect(findByType(render(<Pre>code</Pre>).tree, NATIVE_TEXT)).toBeTruthy()
  // `<br>` has no native equivalent — the fork renders nothing rather than an empty box.
  expect(render(<Br />).tree).toBeNull()
  expect(findByType(render(<Hr />).tree, NATIVE_VIEW)).toBeTruthy()
})

test('the Svg family re-exports react-native-svg and mounts its native views', () => {
  const { tree } = render(
    <Svg>
      <Path d="M0 0 L10 10" />
    </Svg>,
  )
  // The web primitives were named to MIRROR react-native-svg, which is what makes the native fork a
  // plain re-export; these are the views that re-export actually mounts. The root view is
  // `RNSVGSvgView` on iOS and `RNSVGSvgViewAndroid` on Android — hence the prefix match.
  expect(find(tree, (t) => t.startsWith('RNSVGSvgView'))).toBeTruthy()
  expect(hostTypes(tree)).toContain('RNSVGPath')
})

test('IFrame mounts a react-native-webview pointed at src', () => {
  const { tree } = render(<IFrame src="https://lmthing.org" />)
  const webView = find(tree, (t) => t.includes('WebView'))
  expect(webView).toBeTruthy()
  expect((webView?.props.source as { uri?: string })?.uri).toBe('https://lmthing.org')
})

// ── the props axis (what `nativeSafeProps` restored) ──────────────────────────────────────────

test('Box forwards Tamagui style props to the native view', () => {
  const { tree } = render(<Box padding="$4" backgroundColor="$background" borderRadius="$radius-lg" />)
  const style = styleOf(tree, NATIVE_VIEW)
  // The whole point of both targets being Tamagui: one prop, styled on each. These forks used to
  // destructure `style`/`children` only, so a native screen mounted the right tree with NO styling.
  expect(style.paddingTop).toBe(16)
  expect(style.paddingLeft).toBe(16)
  expect(style.borderTopLeftRadius).toBe(8)
  expect(typeof style.backgroundColor).toBe('string')
  expect(String(style.backgroundColor).startsWith('var(')).toBe(false)
})

test('Text forwards typography tokens to the native text', () => {
  const { tree } = render(<Text fontSize="$sm" fontWeight="$bold">tokens</Text>)
  const style = styleOf(tree, NATIVE_TEXT)
  expect(style.fontSize).toBe(14)
  expect(style.fontWeight).toBe('700')
})

test('Row/Col style props compose with the fork own flexDirection', () => {
  const { tree } = render(<Row gap="$2" alignItems="center" />)
  const style = styleOf(tree, NATIVE_VIEW)
  expect(style.flexDirection).toBe('row')
  expect(style.gap).toBe(8)
  expect(style.alignItems).toBe('center')
})

test('role and aria-* become native accessibility props', () => {
  // Tamagui's native path translates these (`createOptimizedView.native.tsx`), so forwarding them
  // keeps the accessibility the surfaces already write instead of dropping it at the fork.
  const { tree } = render(<Box role="button" aria-label="save" aria-disabled />)
  const view = findByType(tree, NATIVE_VIEW)
  expect(view?.props.accessibilityRole).toBe('button')
  expect(view?.props.accessibilityLabel).toBe('save')
  expect(view?.props.accessibilityState).toMatchObject({ disabled: true })
})

test('web-only attributes and DOM-only handlers never reach the native view', () => {
  const { tree } = render(
    <Box
      className="p-4 flex"
      onKeyDown={() => {}}
      onSubmit={() => {}}
      onContextMenu={() => {}}
      testID="kept"
    />,
  )
  const props = findByType(tree, NATIVE_VIEW)?.props ?? {}
  for (const dead of ['className', 'onKeyDown', 'onSubmit', 'onContextMenu']) {
    expect(`${dead}=${String(dead in props)}`).toBe(`${dead}=false`)
  }
  // …while the props RN does understand still arrive.
  expect(props.testID).toBe('kept')
})

test('a ref on a primitive yields a measurable native node', () => {
  // Tamagui renders a host element directly, so this only works because `render()` supplies a
  // `createNodeMock` — the same thing RN's jest preset does for anything that measures.
  const handle: { current: { measureInWindow?: unknown } | null } = { current: null }
  render(<Box ref={handle as never} />)
  expect(typeof handle.current?.measureInWindow).toBe('function')
})
