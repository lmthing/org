import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui.config'
import { Box } from '@lmthing/ui/elements/primitives/index'
import '@lmthing/css/components/computer/computer-layout.css'
import './surface.css'
// Real design-system BEM class (patched to display:flex!) on the REAL Tamagui Box vs a raw div.
function App() {
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <div data-role="ref" className="computer-layout" />
      <Box data-role="cand" className="computer-layout" />
    </TamaguiProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__realBemReady = true
