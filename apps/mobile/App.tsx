import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { useColorScheme } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
import { DemoScreen } from './src/screens/DemoScreen'

/**
 * Root of the LMThing mobile shell. Wraps the app in `TamaguiProvider` with the SHARED
 * `tamagui.config` (generated from the same tokens.json as the web `theme.css`, proven byte-equal
 * by the Layer-1 parity tests), following the light/dark system scheme. The screens live in
 * `@lmthing/ui`; this shell is the native entry + provider.
 *
 * Status: scaffold. Bootstrap with `expo install` in this directory (it is excluded from the pnpm
 * workspace) and run on a device/simulator — see README. The shared className-driven surfaces need
 * the §1c native styling decision before they render fully; `DemoScreen` uses the primitives'
 * native forks directly.
 */
export default function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <StatusBar style="auto" />
      <DemoScreen />
    </TamaguiProvider>
  )
}
