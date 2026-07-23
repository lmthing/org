import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import eqConfig from './eq-tamagui.config'
import { fixtures } from './fixtures'
import { eqFixtures } from './eq-fixtures'
import './harness.css'

/**
 * Harness entry. Renders every fixture into its own labeled stage (`data-fx="<name>"`) so the
 * Playwright specs can locate each by test id, extract its computed styles (L2) and screenshot
 * it (L3). Theme is driven by `?theme=dark|light` → `data-theme` on <html>; the SAME bundle is
 * built once and used for both the passthrough baseline and the Tamagui candidate — the only
 * variable is the primitives' implementation.
 */
const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', theme)

function Harness() {
  return (
    <>
      {/* Passthrough fixtures render BARE — no TamaguiProvider — so the provider's injected
          theme wrapper (which sets `color: var(--color)`) can't leak into their computed styles.
          Only the eq fixtures below, which mount real Tamagui candidates, need the provider. */}
      {fixtures.map((fx) => (
        <div className="fx-case" data-fx={fx.name} key={fx.name}>
          <div className="fx-label">{fx.name}</div>
          <div className="fx-stage" data-fx-stage={fx.name}>
            {fx.render()}
          </div>
        </div>
      ))}
      {/* B1 equivalence pre-proof: plain reference + Tamagui candidate, compared to each other.
          The provider affects ref and candidate identically, so the equivalence still holds. */}
      <TamaguiProvider config={eqConfig} defaultTheme="light">
        {eqFixtures.map((fx) => (
          <div className="fx-case" data-eq-fx={fx.name} key={fx.name}>
            <div className="fx-label">{fx.name}</div>
            <div className="fx-stage" data-eq-stage={fx.name}>
              {fx.ref()}
              {fx.cand()}
            </div>
          </div>
        ))}
      </TamaguiProvider>
    </>
  )
}

const el = document.getElementById('root')!
createRoot(el).render(<Harness />)

// Signal readiness once fonts settle so screenshots are deterministic.
document.fonts.ready.then(() => {
  requestAnimationFrame(() => {
    document.documentElement.setAttribute('data-harness-ready', '1')
  })
})
