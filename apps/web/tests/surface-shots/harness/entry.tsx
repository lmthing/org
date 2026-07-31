import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui.config'
import './harness.css'
import { FIXTURES } from './fixtures'

/**
 * Mounts ONE fixture filling the viewport, inside the same provider and CSS the
 * app uses. One fixture per page load — the point of this harness is that the
 * surface gets the whole viewport, so a container that collapses to zero height
 * shows up as a blank picture instead of hiding inside a stacked stage.
 */
const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const name = params.get('fx') ?? 'team'

document.documentElement.setAttribute('data-theme', theme)

// The team surface opens a channel socket on mount. There is no pod behind this
// harness, and a failing dial would put a red error state in every picture — so
// give it a socket that connects and says nothing.
class DeadSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    setTimeout(() => this.onopen?.(), 0)
  }
  addEventListener(type: string, fn: () => void) {
    if (type === 'open') setTimeout(fn, 0)
  }
  removeEventListener() {}
  send() {}
  close() {}
}
;(globalThis as unknown as Record<string, unknown>)['WebSocket'] = DeadSocket

const Fixture = FIXTURES[name]

function Harness() {
  if (!Fixture) return <div data-fx-missing={name}>no such fixture: {name}</div>
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <div data-fx-stage={name} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Fixture />
      </div>
    </TamaguiProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)

// The shot waits on this rather than a timeout. Two frames after mount, plus a
// beat for the fixtures' resolved-promise data to land.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    setTimeout(() => {
      ;(window as unknown as Record<string, unknown>)['__shotReady'] = true
    }, 250)
  })
})
