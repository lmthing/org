import { describe, it, expect } from 'vitest'
import { classifyInstallResponse } from './install'

describe('classifyInstallResponse', () => {
  it('maps a successful install to done', () => {
    const state = classifyInstallResponse(true, 200, {
      ok: true,
      projectId: 'blog',
      installed: { tables: ['posts'], pages: ['/'], endpoints: [], hooks: [] },
    })
    expect(state.status).toBe('done')
    expect(state).toMatchObject({ info: { projectId: 'blog' } })
  })

  it('maps a diverged (already-installed, edited) response to diverged — not error', () => {
    // The pod returns HTTP 200 { ok:false, diverged:true } when the dest has local
    // edits. This must offer an upgrade, not dead-end in the error branch.
    const state = classifyInstallResponse(true, 200, {
      ok: false,
      diverged: true,
      projectId: 'blog',
      message: '"blog" has local edits ... pass force:true to overwrite them.',
    })
    expect(state.status).toBe('diverged')
    expect(state).toMatchObject({ info: { projectId: 'blog', diverged: true } })
  })

  it('maps a non-diverged failure to error with the server message', () => {
    const state = classifyInstallResponse(false, 500, { ok: false, message: 'boot failed: nope' })
    expect(state).toEqual({ status: 'error', message: 'boot failed: nope' })
  })

  it('falls back to an HTTP-status error message when the body has none', () => {
    const state = classifyInstallResponse(false, 404, null)
    expect(state).toEqual({ status: 'error', message: 'Install failed (HTTP 404).' })
  })
})
