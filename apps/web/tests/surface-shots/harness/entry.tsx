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
  onmessage: ((event: { data: string }) => void) | null = null
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

// The thread fixture exists to photograph a thread, and a thread with THING working in it is the
// state worth looking at: the live activity strip only renders while a turn runs, and a turn is
// something only the socket can announce (`thing_status`). The dead socket says one frame for
// that fixture and nothing for any other, so every other picture is unchanged.
if (name === 'team-thread') {
  class BusyThreadSocket extends DeadSocket {
    constructor() {
      super()
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'thing_status',
            channelId: 'c-general',
            threadId: 'm4',
            status: 'running',
            startedAt: new Date().toISOString(),
            activity: 'Reading the channel history',
          }),
        })
      }, 0)
    }
  }
  ;(globalThis as unknown as Record<string, unknown>)['WebSocket'] = BusyThreadSocket
}

/**
 * The pod, as far as these fixtures are concerned.
 *
 * The chat SIDEBAR is a fetching component — projects, this project's spaces, its conversations,
 * and its app manifest (the `APP` section, `chat/app/use-app-pages.ts`). There is no pod here, so
 * each of those routes is answered with a fixture body; anything else fails as it already did.
 * A sidebar photographed with every section empty is a picture of the loading state, not of the
 * surface.
 */
const NOW = Date.now()
const POD: [RegExp, unknown][] = [
  [
    /\/api\/projects\/[^/]+\/app$/,
    {
      hasApp: true,
      pages: [
        { routePath: '/' },
        { routePath: '/trips' },
        // Dynamic — deliberately in the fixture, so the shot shows it being DROPPED.
        { routePath: '/trips/:tripId' },
        { routePath: '/packing' },
        { routePath: '/settings/profile' },
      ],
    },
  ],
  [
    /\/api\/projects\/[^/]+\/sessions$/,
    {
      sessions: [
        { sessionId: 'sess-fixture', projectId: 'trips', agentSlug: 'thing', spaceDir: '/x', title: 'Three days in Lisbon', lastActivity: NOW - 60_000, status: 'idle', totalCostUsd: 0.0412 },
        { sessionId: 's2', projectId: 'trips', agentSlug: 'thing', spaceDir: '/x', title: 'Packing list for the hike', lastActivity: NOW - 26 * 3_600_000, status: 'idle', totalCostUsd: 0.0083 },
        { sessionId: 's3', projectId: 'trips', agentSlug: 'thing', spaceDir: '/x', title: 'Rebook the Porto train', lastActivity: NOW - 4 * 86_400_000, status: 'idle' },
      ],
    },
  ],
  [/\/api\/projects\/[^/]+\/spaces$/, { spaces: [{ id: 'travel', name: 'Travel' }, { id: 'newsroom', name: 'Newsroom' }] }],
  [/\/api\/projects$/, { projects: [{ id: 'trips', name: 'Trips', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'user', name: 'Personal', createdAt: '2026-01-01T00:00:00.000Z' }] }],
]

const realFetch = globalThis.fetch?.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  for (const [pattern, body] of POD) {
    if (pattern.test(url)) {
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    }
  }
  return realFetch ? realFetch(input, init) : Promise.reject(new Error('no fetch'))
}) as typeof fetch

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
