import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui-web.config'
import './harness.css'
import { FIXTURES } from './fixtures'

/**
 * Mounts every real-surface fixture in a labelled stage, inside the SAME provider the app uses and
 * under the real `theme.css` (Tailwind preflight + the token custom properties). The theme is read
 * from `?theme=` so the capture can walk light and dark from one build.
 */
const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', theme)

function Harness() {
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      {FIXTURES.map((fx) => (
        <div key={fx.name} data-fx-stage={fx.name}>{fx.render()}</div>
      ))}
    </TamaguiProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
// The capture waits on this rather than a timeout.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    ;(window as unknown as Record<string, unknown>)['__surfaceReady'] = true
  })
})
