/**
 * `ChatShell` — the whole signed-in chat surface — MOUNTED on the React Native target.
 *
 * This is the only suite that renders what a mobile user actually sees, rather than a component in
 * isolation, and it exists because of a class of bug nothing else here could catch: a string child
 * mounted directly under a native View. React Native raises "Text strings must be rendered within a
 * <Text> component." and then DROPS the string, so the label is simply absent on screen — but the
 * harness runs on `react-test-renderer`, which has no React Native host config and therefore never
 * runs that check at all (`globals.cjs` even sets `IS_REACT_NATIVE_TEST_ENVIRONMENT`). Asserting
 * the invariant OURSELVES over the mounted tree is what closes that gap.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, flattenStyle, NATIVE_TEXT } from '../render'
import { AuthProvider } from '@lmthing/auth'
import { ChatShell } from '../../src/chat'

/**
 * Every string that mounted somewhere other than under a text host — React Native's own rule,
 * reproduced over the rendered tree. Each entry is `<host type>: <the dropped string>`, so a
 * failure names the text that would have vanished on a device.
 */
function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (type) => type !== NATIVE_TEXT)) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(`${node.type}: ${child}`)
    }
  }
  return out
}

/**
 * Style properties Android's view managers cast to a `Double`. A string reaching one of these is
 * not a layout nit — it is a red-screen crash (`java.lang.String cannot be cast to
 * java.lang.Double`), which is how `lineHeight="$6"` on the composer took the app down the moment a
 * chat was opened: `$6` is not a key in the lineHeight ramp (`xs`/`sm`/`base`/…), so Tamagui had no
 * token to resolve and handed the raw string straight to `AndroidTextInput`.
 *
 * Percentages are excluded — Yoga accepts those as strings for the dimension props.
 *
 * Scope, stated plainly: this walks the shell's EMPTY state, because a fresh store has no active
 * session and so never mounts `ChatView`/`Composer`. The composer's own `lineHeight` was caught on
 * a device and fixed there; rendering it here to close that gap hangs the harness on effects that
 * never settle off-device, so this case does not yet cover it.
 */
const NUMERIC_ONLY_STYLE_PROPS = [
  'lineHeight',
  'fontSize',
  'letterSpacing',
  'borderRadius',
  'borderWidth',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
]

function nonNumericStyles(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, () => true)) {
    const style = flattenStyle(node.props?.style)
    for (const prop of NUMERIC_ONLY_STYLE_PROPS) {
      const value = style[prop]
      if (typeof value === 'string' && !value.endsWith('%')) {
        out.push(`${node.type}.${prop} = ${JSON.stringify(value)}`)
      }
    }
  }
  return out
}

test('the chat shell passes no unresolved string where Android casts a Double', () => {
  const { tree } = render(
    <AuthProvider appName="mobile">
      <ChatShell />
    </AuthProvider>,
  )
  expect(nonNumericStyles(tree)).toEqual([])
})

test('the chat shell mounts no bare strings outside a native text host', () => {
  // The shell reads `useAuth`, so it only mounts under the provider the app gives it.
  const { tree } = render(
    <AuthProvider appName="mobile">
      <ChatShell />
    </AuthProvider>,
  )
  expect(looseStrings(tree)).toEqual([])
})
