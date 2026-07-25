import { describe, it, expect } from 'vitest'

/**
 * Structural guard for the React Native primitive forks (`*.native.tsx`). Metro resolves these on
 * native while web keeps `index.tsx`; this test loads the RN-independent forks (those built on
 * @tamagui/core, not the `react-native` Image/Linking ones) in the node/jsdom env to prove they
 * (a) load — `createTamagui` is configured, `styled()` runs — and (b) export the SAME symbol names
 * with the SAME `displayName` as their web counterpart, so a surface component is cross-target.
 * (Image/Link forks import `react-native` directly and are verified in the mobile app.)
 *
 * The OTHER half — the forks reached the way Metro reaches them (through the barrel, not by an
 * explicit `.native` path), including the ones that import `react-native`/`-svg`/`-webview`, and
 * actually RENDERED on the native target — lives in `libs/ui/metro/suites/primitives.tsx`
 * (`pnpm --filter @lmthing/ui test:native`). Neither replaces the other: this suite is a fast
 * structural guard in the default runner, that one needs a Metro bundle.
 *
 * See docs/react-native-tamagui-migration.md §7 + §8.
 */
import * as BoxWeb from './box/index'
import * as BoxNative from './box/index.native'
import * as TextWeb from './text/index'
import * as TextNative from './text/index.native'
import * as PressWeb from './pressable/index'
import * as PressNative from './pressable/index.native'
import * as RowNative from './row/index.native'
import * as ColNative from './col/index.native'
import * as ListWeb from './list/index'
import * as ListNative from './list/index.native'
import * as MiscNative from './misc.native'
import * as TableNative from './table.native'
import * as FormNative from './form/index.native'

describe('native primitive forks', () => {
  it('load without throwing and are valid components (Tamagui configured)', () => {
    expect(BoxNative.Box).toBeTruthy()
    expect(TextNative.Text).toBeTruthy()
    expect(PressNative.Pressable).toBeTruthy()
    expect(RowNative.Row).toBeTruthy()
    expect(ColNative.Col).toBeTruthy()
    expect(ListNative.List).toBeTruthy()
    expect(ListNative.ListItem).toBeTruthy()
  })

  it('grouped forks (misc/table/form, @tamagui/core-only) load with all their symbols', () => {
    for (const s of ['Pre', 'Br', 'Hr']) expect(MiscNative).toHaveProperty(s)
    for (const s of ['Table', 'Thead', 'Tbody', 'Tfoot', 'Tr', 'Th', 'Td', 'Caption'])
      expect(TableNative).toHaveProperty(s)
    expect(FormNative.Form).toBeTruthy()
  })

  it('export the same symbols + displayName as the web primitive (cross-target API)', () => {
    expect((BoxNative.Box as { displayName?: string }).displayName).toBe(
      (BoxWeb.Box as { displayName?: string }).displayName,
    )
    expect((TextNative.Text as { displayName?: string }).displayName).toBe(
      (TextWeb.Text as { displayName?: string }).displayName,
    )
    expect((PressNative.Pressable as { displayName?: string }).displayName).toBe(
      (PressWeb.Pressable as { displayName?: string }).displayName,
    )
    expect((ListNative.List as { displayName?: string }).displayName).toBe(
      (ListWeb.List as { displayName?: string }).displayName,
    )
    expect((ListNative.ListItem as { displayName?: string }).displayName).toBe(
      (ListWeb.ListItem as { displayName?: string }).displayName,
    )
  })
})
