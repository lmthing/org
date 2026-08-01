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
import { act } from 'react-test-renderer'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiConfig } from '../../src/theme/tamagui.config'
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
  findAll,
  NATIVE_VIEW,
  NATIVE_TEXT,
  NATIVE_IMAGE,
} from '../render'
import {
  Box,
  KeyboardAvoiding,
  Scroll,
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
import { keyboardBehavior } from '../../src/elements/primitives/keyboard-avoiding/index.native'
// The scroll-event translation, reached directly: `ScrollView` substitutes its own handler on the
// host node, so driving it through the rendered tree would test RN's plumbing instead.
import { toWebScrollEvent } from '../../src/elements/primitives/scroll/index.native'

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

test('TextArea GROWS with its content — `multiline` alone does not', () => {
  // The chat composer resizes a web <textarea> by measuring `scrollHeight`, and bailed on native
  // "because multiline handles it". It does not: an RN TextInput keeps the height the layout gave
  // it and scrolls, so a two-line message hid its own first line behind the box edge. The height
  // has to come from onContentSizeChange, which is what this pins.
  const { tree, current } = render(<TextArea value="two lines" maxHeight={180} />)
  expect(flattenStyle(findTextInput(tree)?.props?.style).height).toBe(undefined)

  act(() => {
    findTextInput(tree)?.props?.onContentSizeChange?.({ nativeEvent: { contentSize: { height: 44 } } })
  })
  expect(flattenStyle(findTextInput(current())?.props?.style).height).toBe(44)
})

test('TextArea drops back to one line when the caller clears it', () => {
  // Sending empties the box. Without the reset it keeps the height of the message just sent, so
  // the composer sits three lines tall with nothing in it.
  function Harness({ value }: { value: string }) {
    return <TextArea value={value} />
  }
  const { renderer, tree, current } = render(<Harness value="a long message" />)
  act(() => {
    findTextInput(tree)?.props?.onContentSizeChange?.({ nativeEvent: { contentSize: { height: 60 } } })
  })
  expect(flattenStyle(findTextInput(current())?.props?.style).height).toBe(60)

  act(() => {
    renderer.update(
      <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
        <Harness value="" />
      </TamaguiProvider>,
    )
  })
  expect(flattenStyle(findTextInput(current())?.props?.style).height).toBe(undefined)
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
  // A WEIGHT, not a `fontWeight`. `expo-font` registers each cut under its own family name, so
  // `Manrope-Bold` is a different family from `Manrope` — and Android will NOT synthesise bold from
  // a family whose only registered face is Regular. Tamagui's `face` map (tamagui.config.ts
  // #NATIVE_FACE) therefore resolves the weight to the family and drops the numeric prop.
  // This used to assert `fontWeight === '700'`, which passed while the app bundled no fonts at all
  // and every screen actually rendered in Roboto/SF — the assertion could not tell the difference.
  // Asserting the family is what proves real bold reaches the device.
  expect(style.fontFamily).toBe('Manrope-Bold')
  expect(String(style.fontWeight)).toBe('undefined')
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

test('Scroll mounts a real ScrollView — a View with overflow:auto scrolls NOTHING here', () => {
  // Yoga has no scrolling overflow: content past the parent's edge is CLIPPED, with no warning and
  // no gesture to reach it. Every shared transcript was written as a `Box` with `overflow: 'auto'`,
  // which is exactly right in a browser and is why a phone showed one screenful of a conversation
  // and no way to see the rest.
  const { tree } = render(<Scroll flex={1} />)
  const hosts = hostTypes(tree)
  expect(hosts.some((t) => /ScrollView/.test(t)), `mounts a ScrollView (saw ${hosts.join()})`).toBe(true)
})

test('Scroll puts the region props on the SCROLLER and the content props inside', () => {
  // The split is the whole correctness of the fork. `flex: 1` means "take the space left over" —
  // a statement about the REGION. Applied to the content instead it pins the content to exactly
  // one viewport and the overflow is clipped again: the bug this component exists to fix,
  // reintroduced one level in. That is not hypothetical; it is what the first version did, and a
  // device opened a 19-message channel showing nine of them with no way to reach the rest.
  const { tree } = render(<Scroll flex={1} padding="$4" />)
  const scroller = find(tree, (t) => /ScrollView/.test(t))
  const content = findByType(tree, NATIVE_VIEW)
  const merged = (style: unknown) =>
    Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean)) as Record<string, unknown>

  // Asserted on `flex` alone: it is the prop whose misplacement clips the content, and the two
  // targets resolve spacing tokens into different key shapes (`padding` vs the four sides), which
  // would make a padding assertion a test of Tamagui's resolver rather than of this split.
  expect(merged(scroller?.props.style).flex, 'flex sizes the region').toBe(1)
  expect(merged(content?.props.style).flex, 'and never constrains the content').toBe(undefined)
})



test('Scroll translates a native scroll event into the shape the web caller already reads', () => {
  // `onScroll` is a DOM event on web: callers ask `e.currentTarget.scrollTop/scrollHeight/
  // clientHeight` to decide "is the reader at the bottom?", which is what lets a transcript follow
  // new output WITHOUT yanking someone who scrolled up to reread something. React Native reports
  // the same three numbers under different names on `e.nativeEvent`, and `nativeSafeProps` drops
  // any `on*` prop it does not know — so `onScroll` never arrived here at all and every caller's
  // `atBottom` stayed frozen at its initial value on a phone.
  //
  // Two halves, asserted separately on purpose: that the wiring REACHES the ScrollView, and that
  // the mapping is right. The mapping is checked directly rather than by invoking the rendered
  // node, because `ScrollView` substitutes its own internal handler on the host — driving it
  // through the tree would test RN's plumbing, not this translation.
  const { tree } = render(<Scroll flex={1} onScroll={() => {}} />)
  const scroller = find(tree, (t) => /ScrollView/.test(t))
  expect(typeof scroller?.props.onScroll, 'onScroll reaches the ScrollView at all').toBe('function')
  expect(scroller?.props.scrollEventThrottle, 'and asks for more than one event per gesture').toBe(16)

  const mapped = toWebScrollEvent({
    nativeEvent: {
      contentOffset: { y: 120 },
      layoutMeasurement: { height: 400 },
      contentSize: { height: 900 },
    },
  })
  expect(mapped.currentTarget.scrollTop, 'contentOffset.y → scrollTop').toBe(120)
  expect(mapped.currentTarget.clientHeight, 'layoutMeasurement.height → clientHeight').toBe(400)
  expect(mapped.currentTarget.scrollHeight, 'contentSize.height → scrollHeight').toBe(900)
})

test('Scroll leaves onScroll wiring off entirely when the caller passed none', () => {
  const { tree } = render(<Scroll flex={1} />)
  const scroller = find(tree, (t) => /ScrollView/.test(t))
  expect(scroller?.props.scrollEventThrottle, 'no throttle without a listener').toBe(undefined)
})

/**
 * The style on every host View in the tree, flattened.
 *
 * Not `findByType(NATIVE_VIEW)`: on Android a `ScrollView` renders its OWN content-container View,
 * so the first View in the tree is RN's, not this component's — which is why an assertion written
 * against the first one passed on iOS and failed on Android for the same correct code.
 */
function viewStyles(tree: Parameters<typeof findAll>[0]): Record<string, unknown>[] {
  return findAll(tree, (t) => t === NATIVE_VIEW).map(
    (n) =>
      Object.assign(
        {},
        ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean),
      ) as Record<string, unknown>,
  )
}

test('Scroll stickToEnd anchors short content to the BOTTOM, not the top', () => {
  // `stickToEnd` could only ever scroll, and there is nothing to scroll when the conversation is
  // shorter than the screen — so a quiet channel opened with its messages at the top and a void
  // between the last one and the composer. On this target the answer is the content view growing
  // to fill the region and aligning its children to the end; when the content overflows there is
  // no free space and it is inert.
  const styles = viewStyles(render(<Scroll flex={1} stickToEnd />).tree)
  const anchored = styles.find((st) => st.justifyContent === 'flex-end')
  expect(Boolean(anchored), `a content view aligns to the end (saw ${JSON.stringify(styles)})`).toBe(true)
  expect(anchored?.flexGrow, 'and grows to fill the region first').toBe(1)
})

test('Scroll without stickToEnd leaves the content alignment alone', () => {
  const styles = viewStyles(render(<Scroll flex={1} />).tree)
  expect(styles.some((st) => st.justifyContent === 'flex-end'), 'nothing anchors').toBe(false)
})

test('Scroll stickToEnd MERGES its anchoring into the content style, never replaces it', () => {
  // A plain `style={...}` here overwrote whatever the content props had resolved to — so asking a
  // transcript to bottom-anchor silently deleted its padding and the gap between messages.
  const styles = viewStyles(render(<Scroll flex={1} stickToEnd padding="$4" />).tree)
  const anchored = styles.find((st) => st.justifyContent === 'flex-end')
  expect(Boolean(anchored), 'still anchored').toBe(true)
  const padded = Object.keys(anchored ?? {}).some((k) => /^padding/i.test(k))
  expect(padded, `the caller's padding survives (saw ${Object.keys(anchored ?? {}).join()})`).toBe(true)
})

test('Scroll offers a RefreshControl only when the caller asked for one', () => {
  // Pull-to-refresh is the gesture a phone user reaches for first when a list looks stale, and
  // there was none anywhere in the app. The props are accepted on BOTH targets — the web fork
  // ignores them, since the browser has no such gesture to bind — so a surface says "this list
  // can be refreshed" once instead of growing a native-only branch at its call site.
  const withIt = find(render(<Scroll flex={1} onRefresh={() => {}} />).tree, (t) => /ScrollView/.test(t))
  expect(Boolean(withIt?.props.refreshControl), 'a refreshControl is attached').toBe(true)

  const without = find(render(<Scroll flex={1} />).tree, (t) => /ScrollView/.test(t))
  expect(without?.props.refreshControl, 'and nothing is attached otherwise').toBe(undefined)
})

test('KeyboardAvoiding mounts, and pads only where the OS does not already resize', () => {
  // React Native does not move a layout out of the soft keyboard's way: a composer pinned to the
  // bottom stays put and the keyboard is drawn ON TOP of it, so you cannot see what you are
  // typing. Nothing in this package did anything about that.
  //
  // The `behavior` split is the load-bearing part. Android has ALREADY resized the window by the
  // time this component runs (`windowSoftInputMode: adjustResize`), so padding there subtracts the
  // keyboard's height a second time and leaves the composer floating a keyboard's height up the
  // screen. `undefined` is RN's documented answer for Android, not an omission.
  //
  // Asserted as a decision rather than through the tree: `KeyboardAvoidingView` renders a plain
  // View host and only applies padding once a keyboard is actually up, so a render suite sees
  // nothing either way on either platform.
  expect(keyboardBehavior('ios'), 'iOS must inset itself').toBe('padding')
  expect(keyboardBehavior('android'), 'Android already resized — padding would double-count').toBe(undefined)

  const { tree } = render(<KeyboardAvoiding flex={1} keyboardOffset={44} />)
  const hosts = hostTypes(tree)
  expect(hosts.length > 0, `it mounts something (saw ${hosts.join()})`).toBe(true)
})

test('Pressable forwards hitSlop on native, so a small control can still be reachable', () => {
  // The alternative is padding, and padding moves everything around it: a 16pt icon that must be
  // reachable at 44pt either pushes its neighbours apart or cannot be made reachable at all.
  // Several controls in this app sit at 24-32pt against a 44pt/48dp minimum for exactly that
  // reason. `nativeSafeProps` forwards any non-`on*` prop, so this only had to exist in the type.
  const { tree } = render(<Pressable hitSlop={12} onClick={() => {}} />)
  const host = find(tree, (t) => /View|Text/.test(t))
  expect(host?.props.hitSlop, 'reaches the native host').toBe(12)
})
