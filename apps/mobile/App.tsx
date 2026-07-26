import * as React from 'react'
import { useColorScheme } from 'react-native'
import { TamaguiProvider } from '@tamagui/core'
import { StatusBar } from 'expo-status-bar'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
import { HomeScreen } from './src/screens/HomeScreen'

/**
 * Root of the LMThing mobile app.
 *
 * The provider is the ONLY thing this shell contributes: the config is the shared one, generated
 * from the same `tokens.json` as the web `theme.css` and proven byte-equal by the Layer-1 parity
 * tests, so a colour or radius cannot mean one thing here and another on web.
 *
 * The shell is deliberately this thin. Screens belong in `@lmthing/ui`, where both targets render
 * them from one source; a screen written HERE would be a fork of the product that no gate could
 * see. `scripts/lint-barrel-imports.mjs` enforces that by refusing deep imports into the shared
 * package's internals.
 */
export default function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <StatusBar style="auto" />
      <HomeScreen />
    </TamaguiProvider>
  )
}
