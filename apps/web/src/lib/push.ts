/**
 * Turning browser notifications on, from the page's side.
 *
 * Three things have to line up before a push can arrive, and each can fail
 * independently, so each is reported separately rather than collapsed into a
 * boolean: the browser must support the APIs at all, the gateway must have VAPID
 * credentials, and the user must have granted permission.
 *
 * The permission prompt is never fired on load. A prompt that appears before
 * somebody has seen what the app does is the single most reliable way to get a
 * permanent "block" — which cannot be undone from inside the page. It is asked
 * for only from an explicit control.
 */

import { CLOUD_BASE_URL } from '@/lib/config'

export type PushState =
  | 'unsupported'
  | 'unconfigured'
  | 'denied'
  | 'prompt'
  | 'subscribed'

export interface PushStatus {
  state: PushState
  /** True once the user has an active subscription registered with the gateway. */
  enabled: boolean
}

interface PushConfig {
  vapidPublicKey: string | null
  web: boolean
  expo: boolean
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants raw bytes.
 * Browsers do not do this conversion, and passing the string silently produces a
 * subscription no server can sign for.
 */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  // Allocate the buffer explicitly: a bare `new Uint8Array(n)` is typed over
  // `ArrayBufferLike`, which `applicationServerKey` (a `BufferSource`) will not
  // accept because it could be a `SharedArrayBuffer`.
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

async function fetchConfig(): Promise<PushConfig | null> {
  try {
    const res = await fetch(`${CLOUD_BASE_URL}/api/push/config`)
    return res.ok ? ((await res.json()) as PushConfig) : null
  } catch {
    return null
  }
}

/** Register the worker, returning its registration (or null if unsupported). */
async function register(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null
  try {
    // `ready` rather than the register() result: a worker that is registered but
    // not yet ACTIVE cannot take a push subscription, and register() resolves
    // before activation.
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

/** What the UI should offer, without prompting for anything. */
export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return { state: 'unsupported', enabled: false }
  const config = await fetchConfig()
  if (!config?.web || !config.vapidPublicKey) {
    return { state: 'unconfigured', enabled: false }
  }
  if (Notification.permission === 'denied') return { state: 'denied', enabled: false }

  const registration = await register()
  const existing = await registration?.pushManager.getSubscription()
  if (existing) return { state: 'subscribed', enabled: true }
  return { state: 'prompt', enabled: false }
}

/**
 * Ask for permission and register this device. Returns the new status.
 *
 * Must be called from a user gesture — browsers refuse the permission prompt
 * otherwise, and Safari refuses the subscription too.
 */
export async function enablePush(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<PushStatus> {
  if (!supported()) return { state: 'unsupported', enabled: false }
  const config = await fetchConfig()
  if (!config?.web || !config.vapidPublicKey) {
    return { state: 'unconfigured', enabled: false }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { state: permission === 'denied' ? 'denied' : 'prompt', enabled: false }
  }

  const registration = await register()
  if (!registration) return { state: 'unsupported', enabled: false }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Required by every browser: a push that only the app can read.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
    }))

  const raw = subscription.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  await authFetch(`${CLOUD_BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'web',
      endpoint: raw.endpoint,
      keys: raw.keys,
      label: deviceLabel(),
    }),
  })
  return { state: 'subscribed', enabled: true }
}

/** Unregister this device, both in the browser and on the gateway. */
export async function disablePush(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<PushStatus> {
  const registration = await register()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    const endpoint = subscription.endpoint
    // Gateway first: if the browser unsubscribes and then the network fails, the
    // gateway keeps a row that can never be delivered to and the user has no way
    // to reach it again — the endpoint is gone from their side.
    await authFetch(`${CLOUD_BASE_URL}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
    await subscription.unsubscribe().catch(() => {})
  }
  return { state: Notification.permission === 'denied' ? 'denied' : 'prompt', enabled: false }
}

/** A human-readable name for this device, so a settings list is meaningful. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad/i.test(ua)) return 'iOS'
  if (/mac/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows'
  return 'This device'
}
