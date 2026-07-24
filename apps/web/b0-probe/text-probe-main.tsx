import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider, styled, Text as TText, View as TView } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui-web.config'
import './surface.css'

const TCand = styled(TText, { name: 'TCand' })
const VCand = styled(TView, { name: 'VCand' })
const CLS = 'text-2xl font-bold text-foreground'

function App() {
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <span data-txtref className={CLS}>R</span>
      <TCand data-txtcand className={CLS}>C</TCand>
      <div data-viewref className={CLS}>R</div>
      <VCand data-viewcand className={CLS}>C</VCand>
    </TamaguiProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__textReady = true
