import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui.config'
import { Row } from '@lmthing/ui/elements/primitives/index'
import './surface.css'

/** Verify the WEB config + provider: Row renders, and bg-background is theme-correct in light+dark. */
function App() {
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <Row data-probe className="items-center">
        <div data-inside className="bg-background">x</div>
      </Row>
    </TamaguiProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__themeCheckReady = true
