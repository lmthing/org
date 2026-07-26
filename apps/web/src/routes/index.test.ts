import { describe, it, expect } from 'vitest'
import { surfaceForHost, foreignSurfaceRedirect } from './index'

const loc = (hostname: string, pathname: string, search = '', hash = '') => ({
  hostname,
  pathname,
  search,
  hash,
})

describe('surfaceForHost', () => {
  it('maps each product domain to its surface', () => {
    expect(surfaceForHost('lmthing.chat')).toBe('/chat')
    expect(surfaceForHost('lmthing.studio')).toBe('/studio')
    expect(surfaceForHost('lmthing.computer')).toBe('/computer')
    expect(surfaceForHost('lmthing.app')).toBe('/apps')
    expect(surfaceForHost('lmthing.team')).toBe('/team')
  })

  it('falls back to /studio for unknown / dev hosts', () => {
    expect(surfaceForHost('localhost')).toBe('/studio')
    expect(surfaceForHost('chat.test')).toBe('/studio')
    expect(surfaceForHost('example.com')).toBe('/studio')
    expect(surfaceForHost('')).toBe('/studio')
  })
})

describe('foreignSurfaceRedirect', () => {
  it('bounces a team path off the wrong product domain', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/team/abc/channels'))).toBe(
      'https://lmthing.team/abc/channels',
    )
  })

  it('leaves a team path alone on lmthing.team', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.team', '/team/abc'))).toBeNull()
  })

  it('bounces a foreign surface path to its canonical domain, stripping the prefix', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/studio/foo'))).toBe(
      'https://lmthing.studio/foo',
    )
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/computer/dashboard'))).toBe(
      'https://lmthing.computer/dashboard',
    )
    expect(foreignSurfaceRedirect(loc('lmthing.studio', '/chat/threads/1'))).toBe(
      'https://lmthing.chat/threads/1',
    )
    expect(foreignSurfaceRedirect(loc('lmthing.computer', '/studio/x'))).toBe(
      'https://lmthing.studio/x',
    )
  })

  it('maps the /app prefix (installed apps) to lmthing.app', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/app/blog'))).toBe('https://lmthing.app/blog')
  })

  it('preserves query string and hash', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/studio/foo', '?q=1', '#h'))).toBe(
      'https://lmthing.studio/foo?q=1#h',
    )
  })

  it('redirects a bare prefix to the target root', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/studio'))).toBe('https://lmthing.studio/')
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/app'))).toBe('https://lmthing.app/')
  })

  it('returns null for a same-surface prefix (already on the right domain)', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/chat/x'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('lmthing.studio', '/studio'))).toBeNull()
  })

  it('returns null for non-surface paths', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/settings'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/install'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/apps'))).toBeNull() // launcher, not /app
  })

  it('matches only on a segment boundary', () => {
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/computerish'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('lmthing.chat', '/studioz/x'))).toBeNull()
  })

  it('returns null off production (localhost / *.test) so local links stay routes', () => {
    expect(foreignSurfaceRedirect(loc('localhost', '/studio/foo'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('chat.test', '/studio/foo'))).toBeNull()
    expect(foreignSurfaceRedirect(loc('', '/studio/foo'))).toBeNull()
  })
})
