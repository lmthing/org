import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider, Theme } from '@tamagui/core'
import config from './tamagui.config'
import './styles.css'
import { AlignBox, DirBox, JustifyBox, DisplayBox } from './components'

function App() {
  return (
    <TamaguiProvider config={config} defaultTheme="light">
      <Theme name="light">
        <div>
      {/* Each probe: a Tamagui styled() prop vs a conflicting Tailwind class. */}
      <AlignBox data-testid="align" className="items-center">
        <span>x</span>
      </AlignBox>
      <DirBox data-testid="dir" className="flex-row">
        <span>a</span>
        <span>b</span>
      </DirBox>
      <JustifyBox data-testid="justify" className="justify-end">
        <span>j</span>
      </JustifyBox>
        <DisplayBox data-testid="display" className="hidden">
          <span>d</span>
        </DisplayBox>
        </div>
      </Theme>
    </TamaguiProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__probeReady = true
