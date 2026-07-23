import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { fixtures } from './fixtures'
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
      {fixtures.map((fx) => (
        <div className="fx-case" data-fx={fx.name} key={fx.name}>
          <div className="fx-label">{fx.name}</div>
          <div className="fx-stage" data-fx-stage={fx.name}>
            {fx.render()}
          </div>
        </div>
      ))}
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
