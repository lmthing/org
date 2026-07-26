import { describe, it, expect, beforeEach } from 'vitest'
import { applyUrlToState, syncStateToUrl } from './url-state'
import { useStore } from '../store/store'

/**
 * Deep-link ↔ store sync, on web.
 *
 * There were no tests here before this file, which is why moving the URL behind `platform/deep-link`
 * needed them: the surface's only proof that a `?node=…` link worked was that nobody had complained.
 * These pin the exact query string the web app produces, so the seam can be verified to have changed
 * nothing — the assertions below fail against a reordered or replaced (rather than patched) query.
 */
function setSearch(search: string): void {
  window.history.replaceState(null, '', `/chat${search}`)
}

describe('url-state (web)', () => {
  beforeEach(() => {
    setSearch('')
    useStore.setState({ selectedNodeId: null, tab: 'llm', follow: true })
  })

  it('applies node, tab and follow from the query string', () => {
    setSearch('?node=n-7&tab=statements&follow=0')
    applyUrlToState()

    const s = useStore.getState()
    expect(s.selectedNodeId).toBe('n-7')
    expect(s.tab).toBe('statements')
    expect(s.follow).toBe(false)
  })

  it('leaves state alone when the link carries nothing', () => {
    setSearch('?other=1')
    applyUrlToState()

    const s = useStore.getState()
    expect(s.selectedNodeId).toBe(null)
    expect(s.follow).toBe(true)
  })

  it('writes the store back in the original key order', () => {
    const unsub = syncStateToUrl()
    useStore.setState({ selectedNodeId: 'n-1', tab: 'statements', follow: false })
    unsub()

    // node, then tab, then follow — `URLSearchParams.set` appends, so a different order here would
    // reorder the query string of every chat URL for no reason.
    expect(window.location.search).toBe('?node=n-1&tab=statements&follow=0')
  })

  it('PATCHES the query string, preserving params the surface does not own', () => {
    setSearch('?keep=yes')
    const unsub = syncStateToUrl()
    useStore.setState({ selectedNodeId: 'n-2', tab: 'llm', follow: true })
    unsub()

    // The surface owns node/tab/follow and nothing else; a replace would drop `keep`.
    expect(window.location.search).toContain('keep=yes')
    expect(window.location.search).toContain('node=n-2')
    // `follow` defaults to true and is expressed by ABSENCE, not `follow=1`.
    expect(window.location.search).not.toContain('follow')
  })

  it('drops node from the link when nothing is selected', () => {
    setSearch('?node=stale')
    const unsub = syncStateToUrl()
    useStore.setState({ selectedNodeId: null, tab: 'llm', follow: true })
    unsub()

    expect(window.location.search).not.toContain('node')
  })
})
