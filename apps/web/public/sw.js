/**
 * The service worker — the only part of the app that runs when the app does not.
 *
 * Its whole job is two events. Everything else (rendering, state, auth) belongs
 * to the page; a service worker that starts caching or intercepting fetches
 * becomes the hardest thing in the codebase to reason about, and nothing here
 * needs it.
 *
 * Deliberately NOT precaching or serving the app offline. The surface is a live
 * conversation against a pod: a cached shell would show a stale channel list and
 * a composer that silently drops what you typed, which is worse than a plain
 * "you are offline".
 */

/* eslint-env serviceworker */

// Take over immediately rather than waiting for every tab to close. A push
// subscription is registered against the ACTIVE worker, so a version that only
// activates on the next cold start leaves notifications wired to the old one.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A push with an unreadable body still means SOMETHING happened, and a
    // silent drop is the one outcome a notification must not have.
    payload = { title: 'lmthing', body: 'You have a new message' }
  }

  const title = payload.title || 'lmthing'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      // Same tag ⇒ the OS replaces rather than stacks, so a chatty channel is
      // one notification that updates, not a column of them.
      tag: payload.tag || 'lmthing',
      renotify: true,
      icon: '/favicon.ico/web-app-manifest-192x192.png',
      badge: '/favicon.ico/favicon-96x96.png',
      // Read back in `notificationclick` — the event has no access to the push
      // payload, only to what was attached to the notification.
      data: { url: payload.url || '/team' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/team'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Prefer an open tab. Opening a second window onto a surface the member
      // already has open is the most common complaint about web notifications,
      // and `navigate` keeps the app's own state instead of cold-booting it.
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if ('navigate' in client) await client.navigate(target)
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
