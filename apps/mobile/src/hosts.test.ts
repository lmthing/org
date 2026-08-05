/**
 * The absolute hosts the app talks to.
 *
 * The one that mattered enough to test: a PERSONAL project's app is reached on `lmthing.app`, NOT
 * the chat host (`apiBase()` = `lmthing.chat`). Only `lmthing.app`'s edge routes `/app/*` into the
 * pod (`devops/argocd/envoy/app-routes.yaml`); a `/app/<project>/api/*` call to `lmthing.chat` hits
 * the static chat SPA and the view client reports "request failed". Basing the app client on
 * `lmthing.app` is the whole fix, so it gets a test that would have caught the wrong host.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { appBase, appUrl } from './hosts'

const KEY = 'EXPO_PUBLIC_APP_BASE'

afterEach(() => {
  delete process.env[KEY]
})

describe('appBase', () => {
  it('defaults to the app host, not the chat host', () => {
    delete process.env[KEY]
    expect(appBase()).toBe('https://lmthing.app')
    // The bug was pointing app calls at the chat host, which routes only `/api/*` to the pod.
    expect(appBase()).not.toContain('lmthing.chat')
  })

  it('is overridable for a dev build, trailing slash trimmed', () => {
    process.env[KEY] = 'http://10.0.2.2:3000/'
    expect(appBase()).toBe('http://10.0.2.2:3000')
  })
})

describe('appUrl', () => {
  it('serves a page under `/app/<project>/` on the app host', () => {
    delete process.env[KEY]
    expect(appUrl('trips')).toBe('https://lmthing.app/app/trips/')
    expect(appUrl('trips', '/settings/profile')).toBe('https://lmthing.app/app/trips/settings/profile')
  })
})
