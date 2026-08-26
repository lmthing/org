import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  openSession,
  closeActiveSession,
  getConnectedSessionId,
  startSession,
  resolveProjectChat,
} from './session-control'
import { useStore } from '../store/store'

/**
 * The socket half of "a conversation has a URL".
 *
 * `openSession` is driven from an effect that re-runs on every location change, so it has two
 * obligations neither of which the old click-driven code had: it must be idempotent (a re-render
 * must not tear down a working socket), and it must survive being CALLED AGAIN before it finishes.
 * The second one is not theoretical — holding the back button walks several entries in a few
 * hundred milliseconds, and each one starts a resume POST.
 */
const h = vi.hoisted(() => ({
  connections: [] as { url: string; close: ReturnType<typeof vi.fn> }[],
  post: null as null | ((path: string, body: unknown) => Promise<unknown>),
}))

vi.mock('./api', () => ({
  apiPost: vi.fn((path: string, body: unknown) =>
    h.post ? h.post(path, body) : Promise.resolve({ sessionId: 'x' }),
  ),
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../store/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store/store')>()),
  connectLive: vi.fn((url: string) => {
    const conn = { url, close: vi.fn(), send: vi.fn() }
    h.connections.push(conn)
    return conn
  }),
}))

import { apiPost, apiGet } from './api'

/** A promise this test controls the settling of. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('session-control — following the location', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.connections = []
    h.post = null
    closeActiveSession()
  })

  it('attaches the socket to the conversation it is given', async () => {
    await openSession('trips', 's-1')
    expect(getConnectedSessionId()).toBe('s-1')
    expect(h.connections).toHaveLength(1)
    expect(h.connections[0]!.url).toContain('sessionId=s-1')
    expect(useStore.getState().activeSessionId).toBe('s-1')
    // Resume by id — the pod hands back the SAME id, which is what makes it URL-worthy.
    expect(apiPost).toHaveBeenCalledWith('/api/sessions', { projectId: 'trips', resumeSessionId: 's-1' })
  })

  it('is a no-op for the conversation already open', async () => {
    await openSession('trips', 's-1')
    await openSession('trips', 's-1')
    expect(h.connections).toHaveLength(1)
    expect(apiPost).toHaveBeenCalledTimes(1)
  })

  it('does not let a slow open overwrite a newer one', async () => {
    // Back, Back, quickly: two resumes in flight, the FIRST one answering LAST.
    const slow = deferred<{ sessionId: string }>()
    const fast = deferred<{ sessionId: string }>()
    h.post = (_p, body) =>
      (body as { resumeSessionId: string }).resumeSessionId === 's-old' ? slow.promise : fast.promise

    const first = openSession('trips', 's-old')
    const second = openSession('trips', 's-new')
    fast.resolve({ sessionId: 's-new' })
    await second
    slow.resolve({ sessionId: 's-old' })
    await first

    // Without the guard the surface would end up on `s-old` while the URL said `s-new`.
    expect(getConnectedSessionId()).toBe('s-new')
    expect(h.connections.map((c) => c.url.includes('s-new'))).toEqual([true])
  })

  it('does not let a pending open resurrect a conversation that was closed', async () => {
    const pending = deferred<{ sessionId: string }>()
    h.post = () => pending.promise
    const opening = openSession('trips', 's-1')
    closeActiveSession() // e.g. the chat was deleted while its resume was in flight
    pending.resolve({ sessionId: 's-1' })
    await opening

    expect(getConnectedSessionId()).toBe(null)
    expect(h.connections).toHaveLength(0)
  })

  it('a new chat connects without a second round trip', async () => {
    h.post = () => Promise.resolve({ sessionId: 's-fresh' })
    const id = await startSession('trips')
    expect(id).toBe('s-fresh')
    expect(getConnectedSessionId()).toBe('s-fresh')
    // The POST that created it already made it live, so the location effect that follows finds it
    // connected and does nothing.
    await openSession('trips', 's-fresh')
    expect(apiPost).toHaveBeenCalledTimes(1)
  })

  it('drops the send handle on close, so a submit is never posted into a dead socket', async () => {
    await openSession('trips', 's-1')
    closeActiveSession()
    expect(h.connections[0]!.close).toHaveBeenCalled()
    expect(getConnectedSessionId()).toBe(null)
  })
})

describe('resolveProjectChat — the project’s own chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.connections = []
    h.post = null
    closeActiveSession()
  })

  it('continues the project’s most-recent conversation, without creating one', async () => {
    // `/api/projects/:id/sessions` is newest-first, so the first entry is the one to resume.
    vi.mocked(apiGet).mockResolvedValue({
      sessions: [{ sessionId: 's-recent' }, { sessionId: 's-older' }],
    })
    const id = await resolveProjectChat('trips')
    expect(id).toBe('s-recent')
    expect(apiGet).toHaveBeenCalledWith('/api/projects/trips/sessions')
    // It hands the id back for the shell to open — it does NOT post a new session itself.
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('starts a fresh chat when the project has none', async () => {
    vi.mocked(apiGet).mockResolvedValue({ sessions: [] })
    h.post = () => Promise.resolve({ sessionId: 's-fresh' })
    const id = await resolveProjectChat('trips')
    expect(id).toBe('s-fresh')
    // A brand-new project's first chat is created AND connected in one round trip.
    expect(apiPost).toHaveBeenCalledWith('/api/sessions', { projectId: 'trips' })
    expect(getConnectedSessionId()).toBe('s-fresh')
  })

  it('encodes an odd project id into the sessions path', async () => {
    vi.mocked(apiGet).mockResolvedValue({ sessions: [{ sessionId: 's-1' }] })
    await resolveProjectChat('a/b')
    expect(apiGet).toHaveBeenCalledWith('/api/projects/a%2Fb/sessions')
  })
})
