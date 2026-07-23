import * as React from 'react'
import { SafeAreaView, ScrollView } from 'react-native'
import { Box, Text, Row, Col, Pressable } from '@lmthing/ui/elements/primitives'

/**
 * Demo screen — exercises the primitives' native forks (`*.native.tsx`) under the shared Tamagui
 * theme, proving the config → primitive → screen path renders on React Native. Uses inline RN
 * `style` (not Tailwind className) because native surface styling awaits the §1c decision.
 *
 * This is the seam the real `@lmthing/ui` chat/studio screens plug into once native styling is
 * resolved; it is intentionally small so the scaffold has something to render on first boot.
 */
export function DemoScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>LMThing mobile</Text>
        <Text style={{ opacity: 0.7 }}>
          Rendering the shared @lmthing/ui primitives on Tamagui / React Native.
        </Text>

        <Col style={{ gap: 8 }}>
          <Text style={{ fontWeight: '600' }}>A column</Text>
          <Box style={{ padding: 12, borderRadius: 8 }}>
            <Text>Box (native View)</Text>
          </Box>
          <Row style={{ gap: 8 }}>
            <Box style={{ padding: 8, borderRadius: 999 }}>
              <Text>chip one</Text>
            </Box>
            <Box style={{ padding: 8, borderRadius: 999 }}>
              <Text>chip two</Text>
            </Box>
          </Row>
        </Col>

        <Pressable style={{ padding: 12, borderRadius: 8 }} onClick={() => {}}>
          <Text style={{ fontWeight: '600' }}>Pressable (onClick → onPress)</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}
