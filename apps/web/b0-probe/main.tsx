import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider, Theme } from '@tamagui/core'
import config from './tamagui.config'
import './styles.css'
import { AlignBox, DirBox, JustifyBox, DisplayBox, Row, Col } from './components'

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

        {/* B2 migration-rule proof: plain-Tailwind reference vs migrated Tamagui candidate.
            Rule: items-*, flex-1, min-w-* MOVE to Tamagui props (base sets them unlayered);
            justify-*, gap-* STAY as className (base does not set them; Tailwind wins uncontested). */}
        <div data-testid="lay-ref-1" className="flex items-center justify-between gap-3 flex-1 min-w-0">
          <span>l</span>
          <span>r</span>
        </div>
        <Row
          data-testid="lay-cand-1"
          className="justify-between gap-3"
          alignItems="center"
          flexGrow={1}
          flexShrink={1}
          flexBasis="0%"
          minWidth={0}
        >
          <span>l</span>
          <span>r</span>
        </Row>

        <div data-testid="lay-ref-2" className="flex flex-col items-start gap-2">
          <span>a</span>
          <span>b</span>
        </div>
        <Col data-testid="lay-cand-2" className="gap-2" alignItems="flex-start">
          <span>a</span>
          <span>b</span>
        </Col>
        </div>
      </Theme>
    </TamaguiProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__probeReady = true
