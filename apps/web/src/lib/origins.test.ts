import { describe, it, expect } from 'vitest'
import { resolveApiOrigin } from './origins'

describe('resolveApiOrigin', () => {
  it('production: pod is same-origin, gateway is the canonical domain', () => {
    const loc = { hostname: 'lmthing.studio', origin: 'https://lmthing.studio' }
    expect(resolveApiOrigin('computer', loc, false)).toBe('https://lmthing.studio')
    expect(resolveApiOrigin('cloud', loc, false)).toBe('https://lmthing.cloud')
  })

  it('*.test dev proxy stack: per-service .test vhost', () => {
    const loc = { hostname: 'studio.test', origin: 'https://studio.test' }
    expect(resolveApiOrigin('computer', loc, true)).toBe('https://computer.test')
    expect(resolveApiOrigin('cloud', loc, true)).toBe('https://cloud.test')
  })

  it('pnpm thing (localhost single-port): everything is same-origin', () => {
    // The regression: DEV is true here too, but there is no *.test proxy — the
    // pod WS + gateway calls must stay on the served localhost origin.
    const loc = { hostname: 'localhost', origin: 'http://localhost:8080' }
    expect(resolveApiOrigin('computer', loc, true)).toBe('http://localhost:8080')
    expect(resolveApiOrigin('cloud', loc, true)).toBe('http://localhost:8080')
  })

  it('pnpm thing served on a LAN IP stays same-origin', () => {
    const loc = { hostname: '192.168.1.5', origin: 'http://192.168.1.5:8080' }
    expect(resolveApiOrigin('computer', loc, true)).toBe('http://192.168.1.5:8080')
  })
})
