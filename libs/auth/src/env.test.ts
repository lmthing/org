import { describe, it, expect, afterEach } from 'vitest'
import { isWeb, isDesktopRun, getDesktopBridge, DESKTOP_PROTOCOL_VERSION } from './env'
import { isLocalRun } from './client'

/**
 * These run under the root runner's `environment: 'node'`, with `window` stubbed by hand rather
 * than by jsdom. That is deliberate and not a shortcut: the case under test is a page served from
 * `tauri://localhost`, and jsdom cannot represent a custom-scheme origin at all — its `location` is
 * http/https only. Stubbing is the only way to state the actual bug.
 */
const BRIDGE = {
  protocolVersion: DESKTOP_PROTOCOL_VERSION,
  platform: 'macos' as const,
  mode: 'cloud' as const,
  apiBase: 'https://lmthing.chat',
  cloudBase: 'https://lmthing.cloud',
  teamBase: 'https://lmthing.team',
}

const g = globalThis as unknown as Record<string, unknown>

/** Stand up a minimal browser-shaped global: enough for `isWeb()` and `location.hostname`. */
function asPage(opts: { hostname: string; protocol?: string; bridge?: unknown }): void {
  g['window'] = {
    document: {},
    location: { hostname: opts.hostname, protocol: opts.protocol ?? 'https:' },
    ...(opts.bridge !== undefined ? { __LMTHING_DESKTOP__: opts.bridge } : {}),
  }
}

/** React Native: `window` exists (its bootstrap aliases it to `global`) but `document` never does. */
function asNative(): void {
  g['window'] = { location: undefined }
}

afterEach(() => {
  delete g['window']
})

describe('isWeb', () => {
  it('is false with no window at all (a bare node process)', () => {
    expect(isWeb()).toBe(false)
  })

  it('is false on native, where `window` exists but `document` does not', () => {
    asNative()
    expect(isWeb()).toBe(false)
  })

  it('is true in a browser', () => {
    asPage({ hostname: 'lmthing.chat' })
    expect(isWeb()).toBe(true)
  })
})

describe('getDesktopBridge', () => {
  it('is null in an ordinary browser', () => {
    asPage({ hostname: 'lmthing.chat' })
    expect(getDesktopBridge()).toBeNull()
    expect(isDesktopRun()).toBe(false)
  })

  it('is null on native — reading through `window` there must not throw', () => {
    asNative()
    expect(getDesktopBridge()).toBeNull()
  })

  it('returns the bridge when the shell injected one', () => {
    asPage({ hostname: 'localhost', protocol: 'tauri:', bridge: BRIDGE })
    expect(getDesktopBridge()?.apiBase).toBe('https://lmthing.chat')
    expect(isDesktopRun()).toBe(true)
  })

  it('ignores a bridge announcing a protocol version this build does not understand', () => {
    // Degrading to "not desktop" is the designed failure. A half-understood object would have the
    // app reading fields that may have changed meaning — worse than not reading them at all.
    asPage({ hostname: 'localhost', bridge: { ...BRIDGE, protocolVersion: DESKTOP_PROTOCOL_VERSION + 1 } })
    expect(getDesktopBridge()).toBeNull()
    expect(isDesktopRun()).toBe(false)
  })

  it('ignores a malformed global rather than throwing', () => {
    asPage({ hostname: 'localhost', bridge: 'not-an-object' })
    expect(getDesktopBridge()).toBeNull()
  })
})

describe('isLocalRun', () => {
  it('is false off the web entirely', () => {
    asNative()
    expect(isLocalRun()).toBe(false)
  })

  it('is true on a bare localhost page (the `pnpm thing` case it exists for)', () => {
    asPage({ hostname: 'localhost', protocol: 'http:' })
    expect(isLocalRun()).toBe(true)
  })

  it('is still true for the *.test dev proxy', () => {
    asPage({ hostname: 'computer.test' })
    expect(isLocalRun()).toBe(true)
  })

  it('is false on a production host', () => {
    asPage({ hostname: 'lmthing.chat' })
    expect(isLocalRun()).toBe(false)
  })

  /**
   * The regression the desktop short-circuit exists for. A Tauri webview serves the app from
   * `tauri://localhost` on macOS and Linux, so `location.hostname` is literally `localhost`.
   * Without the guard `isLocalRun()` was true there, `AuthProvider` set `isDemo`, and the shipped
   * app booted into `DEMO_SESSION` with `accessToken: 'demo'`: no login screen, every pod call
   * 401ing. Windows serves from `tauri.localhost`, which did NOT match — so the break was silent
   * AND OS-divergent, reading as "auth is broken on Mac" when auth was never asked for.
   */
  it('is FALSE on tauri://localhost, where the hostname alone would say otherwise', () => {
    asPage({ hostname: 'localhost', protocol: 'tauri:', bridge: BRIDGE })
    expect(isLocalRun()).toBe(false)
  })

  it('is false on Windows too, where the hostname never matched anyway', () => {
    asPage({ hostname: 'tauri.localhost', protocol: 'http:', bridge: { ...BRIDGE, platform: 'windows' } })
    expect(isLocalRun()).toBe(false)
  })

  it('stays false for a desktop in LOCAL mode, pointed at a real loopback sidecar', () => {
    // Why the guard tests `isDesktopRun()` rather than sniffing the `tauri:` scheme: in local mode
    // the shell points this same webview at `http://127.0.0.1:<port>`. A scheme test would let demo
    // mode back in exactly there — against a real pod that has real data to lose.
    asPage({
      hostname: '127.0.0.1',
      protocol: 'http:',
      bridge: { ...BRIDGE, mode: 'local', apiBase: 'http://127.0.0.1:41234' },
    })
    expect(isLocalRun()).toBe(false)
  })
})
