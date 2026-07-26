import * as React from 'react'
import { SafeAreaView, ScrollView } from 'react-native'
import * as Prim from '@lmthing/ui/elements/primitives'
import { Markdown } from '@lmthing/ui/elements/content/markdown'

/**
 * The first screen, built from SHARED components only.
 *
 * It renders the markdown renderer under the `prose` preset — the same code path, and the same
 * scale, the chat transcript uses on web. That makes it a real preview of the product rather than
 * a widget gallery: when `chat/` lands on the native graph (docs/mobile-native-chat.md step 8),
 * a message body will render through exactly this.
 *
 * Everything here is inside the proven native frontier (`libs/ui/metro/entries/surface.ts`):
 * the primitives and `elements/content/markdown`. Nothing above that is imported yet, because
 * nothing above that has been proven to bundle — adding an unproven import here would move the
 * frontier without the gate noticing.
 */
const SAMPLE = [
  '# lmthing',
  '',
  'This screen is rendered by the **same source** as the web app — no fork, no copy.',
  '',
  '- the primitives resolve to React Native views',
  '- markdown is parsed to tokens and rendered as elements',
  '- `dangerouslySetInnerHTML` is gone, so this works with no DOM at all',
  '',
  '> Before this, a markdown block rendered as an empty box on a device.',
  '',
  '```ts',
  'const surface = shared',
  '```',
].join('\n')

export function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Prim.Box padding="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border">
          <Markdown source={SAMPLE} preset="prose" />
        </Prim.Box>
      </ScrollView>
    </SafeAreaView>
  )
}
