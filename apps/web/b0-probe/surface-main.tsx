import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { EmptyState } from '@lmthing/ui/chat/app/EmptyState'
import { EmptyStateCandidate } from './EmptyStateCandidate'
import surfaceConfig from './surface-config'
import './surface.css'

/**
 * Surface migration proof: the REAL chat EmptyState (reference, Tailwind) next to the migrated
 * EmptyStateCandidate (Tamagui Row/Col), both under the compiled theme.css. measure-surface.mjs
 * walks each subtree and asserts computed-style parity. Reference renders bare; the candidate is
 * wrapped in a TamaguiProvider (minimal non-colliding config — colors come from theme.css).
 */
document.documentElement.setAttribute('data-theme', 'light')

function App() {
  const noop = (_: string) => {}
  return (
    <div style={{ padding: 24 }}>
      <div data-surface="ref">
        <EmptyState projectName="Acme" onSuggestion={noop} />
      </div>
      <TamaguiProvider config={surfaceConfig} defaultTheme="light">
        <div data-surface="cand">
          <EmptyStateCandidate projectName="Acme" onSuggestion={noop} />
        </div>
      </TamaguiProvider>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__surfaceReady = true
