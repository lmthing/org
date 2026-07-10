import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitForPodEdge } from './gates'

const token = async () => 'tok'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('waitForPodEdge', () => {
  it('resolves once the pod edge stops returning Envoy no-endpoint 503s', async () => {
    // Freshly-woken pod: Envoy 503 (no endpoint yet) twice, then the pod serves.
    const statuses = [503, 503, 200]
    let calls = 0
    const fetchMock = vi.fn(async () => {
      const status = statuses[Math.min(calls++, statuses.length - 1)]
      return { status } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForPodEdge(token, { timeoutMs: 2_000, intervalMs: 1 }),
    ).resolves.toBeUndefined()
    // Hits the pod's OWN edge (relative, not the gateway origin).
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions')
    expect(calls).toBe(3)
  })

  it('treats a non-503 (e.g. 401) as "edge is wired" and returns immediately', async () => {
    const fetchMock = vi.fn(async () => ({ status: 401 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    await expect(waitForPodEdge(token, { timeoutMs: 2_000, intervalMs: 1 })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling through connection-refused throws', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      if (calls++ < 2) throw new Error('connection refused')
      return { status: 200 } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(waitForPodEdge(token, { timeoutMs: 2_000, intervalMs: 1 })).resolves.toBeUndefined()
    expect(calls).toBe(3)
  })

  it('throws (→ gate Retry state) if the edge never serves before the deadline', async () => {
    const fetchMock = vi.fn(async () => ({ status: 503 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      waitForPodEdge(token, { timeoutMs: 30, intervalMs: 5 }),
    ).rejects.toThrow(/isn't serving yet .*503/)
  })
})
