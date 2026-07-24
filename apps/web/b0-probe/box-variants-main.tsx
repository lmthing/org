import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider, styled, View, createComponent } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui-web.config'
import './surface.css'

/**
 * B3.3 block-`Box` probe. The current `BoxStyled` is `styled(View,{display:'block',…})` → `.is_View`,
 * whose base rule ALSO forces `font-family` + `line-height` (`.font_*,.is_View{…}`). This probe checks
 * whether that collides with a block `<div>` carrying `font-mono`/`text-xs`/`leading-*`, and compares
 * two candidate bases against a plain `<div>`:
 *   A = current `.is_View` + webBlockCompat        B = `.is_Text` + display:block + ws/wrap inherit
 */
const webBlockCompat = { flexShrink: 1, minWidth: 'auto', minHeight: 'auto' } as const
const CandViewBox = styled(View, { name: 'BoxV', display: 'block', ...webBlockCompat }) as unknown as React.ComponentType<any>
const CandTextBox = createComponent({
  Component: 'div' as never,
  isText: true,
  isReactNative: false,
  acceptsClassName: true,
  componentName: 'BoxT',
  defaultProps: { display: 'block', whiteSpace: 'inherit', wordWrap: 'inherit', ...webBlockCompat },
}) as unknown as React.ComponentType<any>

type Case = [string, React.ReactElement, React.ReactElement, React.ReactElement]
const cases: Case[] = [
  ['bem-bang', <div className="bemflexbang">x</div>, <CandViewBox className="bemflexbang">x</CandViewBox>, <CandTextBox className="bemflexbang">x</CandTextBox>],
  ['bem-display', <div className="bemflex">x</div>, <CandViewBox className="bemflex">x</CandViewBox>, <CandTextBox className="bemflex">x</CandTextBox>],
  ['bem-margin', <div className="bemmargin">x</div>, <CandViewBox className="bemmargin">x</CandViewBox>, <CandTextBox className="bemmargin">x</CandTextBox>],
  [
    'font-mono-text-xs',
    <div className="font-mono text-xs leading-5 px-2">code</div>,
    <CandViewBox className="font-mono text-xs leading-5 px-2">code</CandViewBox>,
    <CandTextBox className="font-mono text-xs leading-5 px-2">code</CandTextBox>,
  ],
  [
    'text-sm',
    <div className="text-sm px-2">body</div>,
    <CandViewBox className="text-sm px-2">body</CandViewBox>,
    <CandTextBox className="text-sm px-2">body</CandTextBox>,
  ],
  [
    'plain',
    <div className="px-2 py-1 bg-muted rounded">plain</div>,
    <CandViewBox className="px-2 py-1 bg-muted rounded">plain</CandViewBox>,
    <CandTextBox className="px-2 py-1 bg-muted rounded">plain</CandTextBox>,
  ],
]

function App() {
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <div style={{ padding: 24, fontFamily: 'var(--font-sans)' }}>
        {cases.map(([label, ref, a, b]) => (
          <div key={label} data-case={label} style={{ display: 'flex', gap: 40 }}>
            <div data-role="ref">{ref}</div>
            <div data-role="candV">{a}</div>
            <div data-role="candT">{b}</div>
          </div>
        ))}
      </div>
    </TamaguiProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__boxReady = true
