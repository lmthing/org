import { describe, it, expect, vi } from 'vitest'
import { buildViewRequest, createViewClient, podOrigin, ViewHttpError, type EndpointManifest } from './client'

/**
 * The client, in BOTH configurations.
 *
 * The request-building cases mirror `libs/cli/src/app/runtime/client.test.ts` deliberately:
 * this is a re-implementation (the cli package depends on this one, so importing back would
 * be a cycle) and the whole value of a re-implementation is that it is pinned to the same
 * behaviour.
 */

const MANIFEST: EndpointManifest = {
  feedList: { method: 'GET', routePath: '/feed' },
  getItem: { method: 'GET', routePath: '/items/:id' },
  home: { method: 'GET', routePath: '/' },
  markRead: { method: 'POST', routePath: '/read' },
  updateItem: { method: 'PATCH', routePath: '/items/:id' },
  dropItem: { method: 'DELETE', routePath: '/items/:id' },
}

describe('buildViewRequest — today`s `buildRequest` semantics', () => {
  it('fills :param segments and consumes those keys', () => {
    const r = buildViewRequest(MANIFEST.getItem, { id: '5' }, '/app/feed')
    expect(r.url).toBe('/app/feed/api/items/5')
    expect(r.init.body).toBeUndefined()
  })

  it('GET sends the remainder as a query string', () => {
    const r = buildViewRequest(MANIFEST.feedList, { unreadOnly: true, limit: 2 }, '/app/feed')
    expect(r.url).toBe('/app/feed/api/feed?unreadOnly=true&limit=2')
  })

  it('a root route yields `<base>/api` with no trailing slash', () => {
    expect(buildViewRequest(MANIFEST.home, {}, '/app/feed').url).toBe('/app/feed/api')
  })

  it('POST sends a JSON body', () => {
    const r = buildViewRequest(MANIFEST.markRead, { id: 7, seen: true }, '/app/feed')
    expect(r.init.body).toBe(JSON.stringify({ id: 7, seen: true }))
    expect(r.init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('PATCH puts the path param in the URL and the rest in the body', () => {
    const r = buildViewRequest(MANIFEST.updateItem, { id: '9', title: 'hi' }, '/app/feed')
    expect(r.url).toBe('/app/feed/api/items/9')
    expect(r.init.body).toBe(JSON.stringify({ title: 'hi' }))
  })

  it('DELETE is a query method, like GET', () => {
    const r = buildViewRequest(MANIFEST.dropItem, { id: '3', reason: 'dupe' }, '')
    expect(r.url).toBe('/api/items/3?reason=dupe')
    expect(r.init.body).toBeUndefined()
  })
})

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('the two configurations', () => {
  it('WEB — an app base, cookies, and NO authorization header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }))
    const client = createViewClient({
      baseUrl: '/app/kitchen',
      endpoints: MANIFEST,
      credentials: 'include',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.call('feedList')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/app/kitchen/api/feed')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('NATIVE — an absolute pod URL and a bearer token, no origin assumed anywhere', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }))
    const client = createViewClient({
      baseUrl: 'https://pod-42.lmthing.cloud/app/kitchen',
      getToken: async () => 'tok-abc',
      endpoints: MANIFEST,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.call('getItem', { id: '5' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://pod-42.lmthing.cloud/app/kitchen/api/items/5')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-abc')
  })

  it('a trailing slash on the base never doubles', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}))
    const client = createViewClient({
      baseUrl: 'https://pod/app/x/',
      endpoints: MANIFEST,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.call('home')
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://pod/app/x/api')
  })
})

describe('errors', () => {
  it('an unknown endpoint name is named', async () => {
    const client = createViewClient({ endpoints: MANIFEST, fetchImpl: (async () => jsonResponse({})) as never })
    await expect(client.call('nope')).rejects.toThrow(/unknown endpoint "nope"/)
  })

  it('a non-2xx surfaces the pod`s { error } contract', async () => {
    const client = createViewClient({
      endpoints: MANIFEST,
      fetchImpl: (async () =>
        jsonResponse({ error: { status: 422, message: 'title is required' } }, false, 422)) as never,
    })
    await expect(client.call('markRead')).rejects.toMatchObject({ status: 422, message: 'title is required' })
    await expect(client.call('markRead')).rejects.toBeInstanceOf(ViewHttpError)
  })
})

describe('host capabilities degrade rather than crash', () => {
  it('confirm defaults to allowing, so a host with no dialog still works', async () => {
    const client = createViewClient({ endpoints: MANIFEST })
    expect(await client.confirm('really?')).toBe(true)
  })

  it('and a supplied confirm is honoured', async () => {
    const client = createViewClient({ endpoints: MANIFEST, confirm: () => false })
    expect(await client.confirm('really?')).toBe(false)
  })
})

// ── podOrigin: the assistant dock 404'd on every page of every app ───────────────────────────────
// `baseUrl` is the APP base on web and the absolute POD url on native, and `POST /api/sessions` is a
// POD route. Resolving it against the app base gave `…/app/<project>/api/sessions`, which the app
// router does not serve — so the one control present in the shell of every page answered 404. It was
// invisible on native, where baseUrl already IS the pod origin.
describe('podOrigin', () => {
  it('strips the /app/<project> suffix from a web app base', () => {
    expect(podOrigin('http://localhost:4321/app/bike-workshop')).toBe('http://localhost:4321')
    expect(podOrigin('http://localhost:4321/app/bike-workshop/')).toBe('http://localhost:4321')
  })

  it('leaves an absolute POD url alone — the native configuration must not be rewritten', () => {
    expect(podOrigin('https://pod.example.com')).toBe('https://pod.example.com')
    expect(podOrigin('https://pod.example.com/')).toBe('https://pod.example.com')
  })

  it('handles a RELATIVE app base, which is what the web wrapper actually passes', () => {
    expect(podOrigin('/app/bike-workshop')).toBe('')
  })

  it('only strips a trailing /app/<id> — a project literally called "app" elsewhere is untouched', () => {
    expect(podOrigin('http://h/app/x/deeper')).toBe('http://h/app/x/deeper')
  })
})
