/**
 * The native-vs-WebView branch, and the route lookup the native path needs.
 *
 * Node-safe on purpose: `app-views.ts` imports nothing from `@lmthing/ui/view` but
 * TYPES, so the branch that decides whether a phone loads a browser is testable
 * without Metro, a renderer, or a device. What Metro must prove (that the renderer
 * resolves and mounts) is `pnpm test:native`'s job; what a decision table can prove
 * is here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ShellSpec, ViewSpec } from '@lmthing/ui/view'

import {
  fetchAppTarget,
  initialRoute,
  resolveRoute,
  routeForServedPath,
  servedRoutePath,
} from './app-views'

const VIEWS = [
  { route: 'index', sections: [] },
  { route: 'recipes/new', sections: [] },
  { route: 'recipes/[id]', sections: [] },
  { route: 'trips/[tripId]/expenses', sections: [] },
] as unknown as ViewSpec[]

function stubFetch(impl: (url: string) => { status?: number; body?: unknown } | Error) {
  vi.stubGlobal('fetch', async (url: string) => {
    const out = impl(url)
    if (out instanceof Error) throw out
    return {
      ok: (out.status ?? 200) < 400,
      status: out.status ?? 200,
      json: async () => out.body,
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAppTarget', () => {
  const getToken = async () => 'tok'

  it('asks the pod for the project’s specs, with the pod token', async () => {
    const seen: { url: string; auth: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, auth: init.headers.authorization })
      return { ok: true, status: 200, json: async () => ({ views: [] }) }
    })
    await fetchAppTarget('https://pod.test', getToken, 'kitchen')
    expect(seen[0]!.url).toBe('https://pod.test/api/apps/kitchen/views')
    expect(seen[0]!.auth).toBe('Bearer tok')
  })

  it('is native when the pod returned specs', async () => {
    stubFetch(() => ({
      body: {
        project: 'kitchen',
        views: VIEWS,
        layouts: [{ prefix: 'recipes', sections: [] }],
        components: [{ name: 'RecipeCard', node: {} }],
        shell: { brand: 'Kitchen' },
        endpoints: { listRecipes: { method: 'GET', routePath: '/recipes' } },
      },
    }))
    const target = await fetchAppTarget('https://pod.test', getToken, 'kitchen')
    expect(target.kind).toBe('native')
    if (target.kind !== 'native') return
    expect(target.app.views).toHaveLength(4)
    expect(target.app.layouts).toEqual([{ prefix: 'recipes', sections: [] }])
    expect(target.app.endpoints['listRecipes']).toMatchObject({ method: 'GET' })
    expect(target.app.shell).toMatchObject({ brand: 'Kitchen' })
  })

  it('is a WebView when the app has no specs — the appbuilder path, and the default', async () => {
    stubFetch(() => ({ body: { views: [] } }))
    expect((await fetchAppTarget('https://pod.test', getToken, 'blog')).kind).toBe('webview')
  })

  it('fails to the WebView, never to an error: a pod without the route still opens its apps', async () => {
    stubFetch(() => ({ status: 404 }))
    expect((await fetchAppTarget('https://pod.test', getToken, 'blog')).kind).toBe('webview')

    stubFetch(() => new Error('offline'))
    expect((await fetchAppTarget('https://pod.test', getToken, 'blog')).kind).toBe('webview')

    stubFetch(() => ({ body: { nonsense: true } }))
    expect((await fetchAppTarget('https://pod.test', getToken, 'blog')).kind).toBe('webview')
  })
})

describe('resolveRoute', () => {
  it('matches a static route exactly', () => {
    expect(resolveRoute(VIEWS, 'index')?.spec.route).toBe('index')
  })

  it('binds a filled [param] back to its name', () => {
    const hit = resolveRoute(VIEWS, 'trips/abc/expenses')
    expect(hit?.spec.route).toBe('trips/[tripId]/expenses')
    expect(hit?.params).toEqual({ tripId: 'abc' })
  })

  it('prefers a static segment over a parameter — `recipes/new` is a page, not an id', () => {
    const hit = resolveRoute(VIEWS, 'recipes/new')
    expect(hit?.spec.route).toBe('recipes/new')
    expect(hit?.params).toEqual({})
  })

  it('is null for a route no spec owns, rather than guessing one', () => {
    expect(resolveRoute(VIEWS, 'nope')).toBeNull()
    expect(resolveRoute(VIEWS, 'trips/abc')).toBeNull()
  })
})

describe('initialRoute', () => {
  const shell = { nav: [{ route: 'recipes/new' }] } as unknown as ShellSpec

  it('lands on the shell’s first destination', () => {
    expect(initialRoute(VIEWS, shell)).toBe('recipes/new')
  })

  it('falls back to `index`, then to the first spec', () => {
    expect(initialRoute(VIEWS, null)).toBe('index')
    const noIndex = VIEWS.slice(1)
    expect(initialRoute(noIndex, null)).toBe('recipes/new')
  })

  it('ignores a nav entry pointing at a page that does not exist', () => {
    const bad = { nav: [{ route: 'ghost' }] } as unknown as ShellSpec
    expect(initialRoute(VIEWS, bad)).toBe('index')
  })
})

describe('servedRoutePath', () => {
  // The mapping MUST agree with the pod's `viewRoutePath` — the sidebar's routes come from there.
  it('collapses `index` to `/` and brackets to `:param`', () => {
    expect(servedRoutePath('index')).toBe('/')
    expect(servedRoutePath('recipes/new')).toBe('/recipes/new')
    expect(servedRoutePath('recipes/[id]')).toBe('/recipes/:id')
    expect(servedRoutePath('trips/[tripId]/expenses')).toBe('/trips/:tripId/expenses')
    expect(servedRoutePath('recipes/index')).toBe('/recipes')
  })
})

describe('routeForServedPath', () => {
  it('maps a served sidebar route back to the authoring route that owns it', () => {
    expect(routeForServedPath(VIEWS, '/')).toBe('index')
    expect(routeForServedPath(VIEWS, '/recipes/new')).toBe('recipes/new')
  })

  it('resolves a dynamic served pattern to its bracketed authoring route', () => {
    // The sidebar drops dynamic pages, so this is not the live path — but the mapping must still be
    // the inverse of `servedRoutePath` for every route, not only the static ones.
    expect(routeForServedPath(VIEWS, '/recipes/:id')).toBe('recipes/[id]')
  })

  it('returns null when no view owns the route (a stale manifest, a legacy page)', () => {
    expect(routeForServedPath(VIEWS, '/ghost')).toBeNull()
  })
})

