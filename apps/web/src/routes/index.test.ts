import { describe, it, expect } from 'vitest'
import { surfaceForHost } from './index'

describe('surfaceForHost', () => {
  it('maps each product domain to its surface', () => {
    expect(surfaceForHost('lmthing.chat')).toBe('/chat')
    expect(surfaceForHost('lmthing.studio')).toBe('/studio')
    expect(surfaceForHost('lmthing.computer')).toBe('/computer')
    expect(surfaceForHost('lmthing.app')).toBe('/app')
  })

  it('falls back to /studio for unknown / dev hosts', () => {
    expect(surfaceForHost('localhost')).toBe('/studio')
    expect(surfaceForHost('chat.test')).toBe('/studio')
    expect(surfaceForHost('example.com')).toBe('/studio')
    expect(surfaceForHost('')).toBe('/studio')
  })
})
