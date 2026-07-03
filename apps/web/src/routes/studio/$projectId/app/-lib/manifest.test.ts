import { describe, it, expect } from 'vitest'
import {
  pagePath,
  endpointPath,
  hookPath,
  tablePath,
  manifestFilePaths,
  type AppManifest,
} from './manifest'

describe('manifest path helpers', () => {
  it('derives page source paths from routes', () => {
    expect(pagePath({ route: '/' })).toBe('pages/index.tsx')
    expect(pagePath({ route: '/stats' })).toBe('pages/stats.tsx')
    expect(pagePath({ route: '/items/:id' })).toBe('pages/items/[id].tsx')
    // Explicit path wins over derivation.
    expect(pagePath({ route: '/x', path: 'pages/custom.tsx' })).toBe('pages/custom.tsx')
  })

  it('derives endpoint source paths (route dir + METHOD filename)', () => {
    expect(endpointPath({ name: 'markRead', method: 'post', route: '/api/mark-read' })).toBe(
      'api/mark-read/POST.ts',
    )
    expect(endpointPath({ name: 'getItem', method: 'GET', route: '/api/items/:id' })).toBe(
      'api/items/[id]/GET.ts',
    )
    expect(endpointPath({ name: 'x', method: 'GET', path: 'api/x/GET.ts' })).toBe('api/x/GET.ts')
  })

  it('derives hook and table source paths', () => {
    expect(hookPath({ slug: 'refresh-feed' })).toBe('hooks/refresh-feed.ts')
    expect(tablePath({ name: 'feed_items' })).toBe('database/feed_items.json')
  })

  it('collects a sorted, de-duplicated file tree from a full manifest', () => {
    const manifest: AppManifest = {
      tables: [{ name: 'feed_items', columns: [{ name: 'id', primaryKey: true }] }],
      pages: [{ route: '/' }, { route: '/items/:id' }],
      endpoints: [
        { name: 'feedList', method: 'GET', route: '/api/feed-list' },
        { name: 'markRead', method: 'POST', route: '/api/mark-read' },
      ],
      hooks: [{ slug: 'refresh-feed', type: 'cron' }],
    }
    expect(manifestFilePaths(manifest)).toEqual([
      'api/feed-list/GET.ts',
      'api/mark-read/POST.ts',
      'database/feed_items.json',
      'hooks/refresh-feed.ts',
      'package.json',
      'pages/index.tsx',
      'pages/items/[id].tsx',
    ])
  })

  it('tolerates an empty / spaces-only manifest', () => {
    expect(manifestFilePaths({})).toEqual(['package.json'])
    expect(manifestFilePaths({ hasApp: false })).toEqual(['package.json'])
  })
})
