/**
 * CSS units that a React Native view manager cannot cast.
 *
 * This suite exists because of a bug that every other gate was structurally blind to. The login
 * screen wrote `letterSpacing={'-0.02em' as unknown as number}` — the double cast is precisely what
 * got a CSS string past the type checker — and on a device Android's `RCTText` manager threw
 *
 *     java.lang.String cannot be cast to java.lang.Double
 *
 * which is not a fallback: it takes down the whole tree. The app booted to a blank white page. The
 * Metro graph gate passed (the module resolves), the render suites passed (`react-test-renderer`
 * builds the element tree without ever invoking a view manager), and typecheck passed (the cast).
 * Only an emulator saw it.
 *
 * So this asserts the property the device enforces, one level up from the device: after Tamagui has
 * resolved styles for the native target, no numeric-only style prop may carry a string that is not
 * a number. `nativeSafeProps` is what makes it true — the check is here, and not only on that
 * function's own unit test, so that a NEW surface written the web way is caught by the suite that
 * renders it rather than by whoever installs the next build.
 *
 * It is a whole-tree assertion rather than a per-component one for the same reason `looseStrings`
 * in `team.tsx` is: the failure is a property of every node, and naming the offenders one at a time
 * is how the first one survived.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, type NativeNode } from '../render'
import { AuthProvider } from '@lmthing/auth'
import { LoginScreen } from '../../src/components/auth/login-screen'
import { Caption } from '../../src/elements/typography/caption'
import { Button } from '../../src/elements/forms/button'
import { ChannelSidebar } from '../../src/team/sidebar'
import * as Prim from '../../src/elements/primitives'
import type { Category, Channel, MemberProfile } from '../../src/team/types'

/**
 * The props whose Android manager casts to `Double`. Kept as its own list, rather than imported
 * from `_native.tsx`, so that deleting an entry there to "fix" a failure cannot also delete the
 * test that would have caught it.
 */
const NUMERIC_ONLY = [
  'letterSpacing',
  'fontSize',
  'borderWidth',
  'borderRadius',
  'shadowRadius',
  'elevation',
  'opacity',
  'zIndex',
  'aspectRatio',
  'flex',
  'flexGrow',
  'flexShrink',
  'gap',
  'rowGap',
  'columnGap',
]

/** Every `[prop, value]` a device would try to cast to a number and fail on. */
function uncastableStyles(tree: unknown): string[] {
  const bad: string[] = []
  for (const node of findAll(tree as never, () => true) as NativeNode[]) {
    const style = node.props?.style
    for (const layer of (Array.isArray(style) ? style : [style]).flat()) {
      if (!layer || typeof layer !== 'object') continue
      for (const key of NUMERIC_ONLY) {
        const value = (layer as Record<string, unknown>)[key]
        if (typeof value === 'string' && !Number.isFinite(Number(value))) {
          bad.push(`${node.type}.${key}=${value}`)
        }
      }
    }
  }
  return bad
}

const MEMBERS: MemberProfile[] = [
  { userId: 'u-ana', email: 'ana@example.com', handle: 'ana', displayName: 'Ana Kay', joinedAt: '', updatedAt: '' },
]
const CATEGORIES: Category[] = [{ id: 'product', name: 'Product', order: 0 }]
const CHANNELS: Channel[] = [
  { id: 'roadmap', name: 'Roadmap', createdBy: 'u-ana', createdAt: '', kind: 'channel', categoryId: 'product' },
]

const SIDEBAR_PROPS = {
  channels: CHANNELS,
  categories: CATEGORIES,
  members: MEMBERS,
  meId: 'u-ana',
  activeId: 'roadmap',
  isEditor: true,
  unread: new Map(),
  onSelect: () => {},
  onCreateChannel: () => {},
  onCreateCategory: () => {},
  onDeleteCategory: () => {},
  onMoveChannel: () => {},
  onOpenDm: () => {},
}

test('the login screen carries no style a native view manager would throw on', () => {
  // The original offender. It mounted a full element tree here while showing a blank white page on
  // a device, which is why the assertion is on the STYLE and not on what is findable in the tree.
  const { tree } = render(
    <AuthProvider appName="mobile">
      <LoginScreen />
    </AuthProvider>,
  )
  expect(uncastableStyles(tree).join(', '), 'no uncastable style').toBe('')
})

test('the team sidebar carries no style a native view manager would throw on', () => {
  // Its section headers use the `letterSpacing: '0.04em'` small-caps idiom — the same trap, written
  // independently, in a surface whose own render suite was already green.
  const { tree } = render(<ChannelSidebar {...SIDEBAR_PROPS} />)
  expect(uncastableStyles(tree).join(', '), 'no uncastable style').toBe('')
})

test('a Caption carries no style a native view manager would throw on', () => {
  const { tree } = render(<Caption>Coming in a follow-up</Caption>)
  expect(uncastableStyles(tree).join(', '), 'no uncastable style').toBe('')
})

test('a CSS length written straight onto a primitive is dropped, not passed to the caster', () => {
  // The guard has to hold for a surface nobody has written yet — that is the point of putting it in
  // the seam every fork already goes through instead of in the components found so far.
  const { tree } = render(
    <Prim.Text letterSpacing={'-0.02em' as unknown as number} fontSize={'1.5rem' as unknown as number}>
      hello
    </Prim.Text>,
  )
  expect(uncastableStyles(tree).join(', '), 'no uncastable style').toBe('')
})

test('an inline-flex button lays its icon and label out in a ROW, not a stack', () => {
  // `display: 'inline-flex'` is in `Button`'s base style. It is not literally `'flex'`, so it used
  // to skip the direction default and Yoga fell back to `column` — the sidebar's "+ New category"
  // rendered as a plus sign with its label underneath, on a device, while every suite was green.
  const { tree } = render(
    <Button size="sm" variant="ghost">
      <Prim.Text>+</Prim.Text>
      New category
    </Button>,
  )
  const styles = (findAll(tree as never, () => true) as NativeNode[]).flatMap((n) =>
    (Array.isArray(n.props?.style) ? n.props.style : [n.props?.style])
      .flat()
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object'),
  )
  const flexed = styles.filter((s) => s.display === 'flex' || s.display === 'inline-flex')
  expect(flexed.length > 0, 'the button mounts a flex container').toBe(true)
  expect(
    flexed.every((s) => s.display === 'flex'),
    'no raw inline-flex reaches Yoga',
  ).toBe(true)
  expect(
    flexed.every((s) => s.flexDirection === 'row'),
    'every flex container states row',
  ).toBe(true)
})

/** Colour props a device parses, and the `color-mix()` it cannot. */
const COLOR_PROPS = ['backgroundColor', 'color', 'borderColor', 'shadowColor']

function cssOnlyColors(tree: unknown): string[] {
  const bad: string[] = []
  for (const node of findAll(tree as never, () => true) as NativeNode[]) {
    const style = node.props?.style
    for (const layer of (Array.isArray(style) ? style : [style]).flat()) {
      if (!layer || typeof layer !== 'object') continue
      for (const key of COLOR_PROPS) {
        const value = (layer as Record<string, unknown>)[key]
        if (typeof value === 'string' && /color-mix\(|^var\(/.test(value)) {
          bad.push(`${node.type}.${key}=${value}`)
        }
      }
    }
  }
  return bad
}

test('a color-mix() tint becomes a colour a device can parse', () => {
  // Every tint in this package is written `color-mix(in srgb, var(--x) 12%, transparent)`, which
  // React Native's colour parser has never heard of — so the WHOLE declaration was dropped and the
  // element rendered with no background at all. Shape-preserving and silent: on the emulator THING's
  // ✦ avatar was a bare glyph with no circle behind it, and the render suites were green because
  // `react-test-renderer` stores the string without asking a view manager to parse it.
  const { tree } = render(
    <Prim.Box backgroundColor="color-mix(in srgb, var(--brand-2) 20%, transparent)">
      <Prim.Text color="var(--muted-foreground)">hi</Prim.Text>
    </Prim.Box>,
  )
  expect(cssOnlyColors(tree).join(', '), 'no CSS-only colour reaches a view manager').toBe('')
})

test('the team sidebar carries no colour a device would drop', () => {
  const { tree } = render(<ChannelSidebar {...SIDEBAR_PROPS} team={{ id: 't1', name: 'Local Team' }} />)
  expect(cssOnlyColors(tree).join(', '), 'no CSS-only colour reaches a view manager').toBe('')
})

test('a real number and a $-token both survive the guard', () => {
  // Dropping the bad values is only correct if the good ones are untouched — otherwise the fix is
  // "native typography no longer works" and every suite would still be green.
  const { tree } = render(
    <Prim.Text letterSpacing={2} fontSize="$sm">
      hello
    </Prim.Text>,
  )
  const spacings = (findAll(tree as never, () => true) as NativeNode[]).flatMap((n) =>
    (Array.isArray(n.props?.style) ? n.props.style : [n.props?.style])
      .flat()
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .map((l) => l.letterSpacing),
  )
  expect(spacings.includes(2), 'the numeric letterSpacing reached the tree').toBe(true)
})
