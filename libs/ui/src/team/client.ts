/**
 * The team pod's API, as a client both targets can use.
 *
 * The one thing that genuinely differs between web and native is WHERE the pod
 * is and how a token is obtained: on web the surface is served from the pod's own
 * origin and holds a team token minted by the gateway; on native there is no
 * origin at all and every URL must be absolute. So the client takes both as
 * configuration rather than reaching for either.
 *
 * `fetch` and `WebSocket` are the only platform APIs used, and React Native has
 * both. Nothing here touches the DOM.
 */

import type {
  Category,
  Channel,
  ChannelMessage,
  ChannelUnread,
  Directory,
  MemberProfile,
} from './types'

export interface TeamTransport {
  /**
   * Origin the pod is reached at. Empty string on web, where the surface is
   * served from the pod's own origin and a relative path is correct.
   */
  baseUrl: string
  /** A valid team token, re-minted by the caller as needed. */
  getToken: () => Promise<string>
}

export interface TeamClient {
  channels(): Promise<{ channels: Channel[]; categories: Category[]; unread: ChannelUnread[] }>
  createChannel(name: string, categoryId?: string): Promise<{ channel: Channel; created: boolean }>
  patchChannel(
    channelId: string,
    patch: { name?: string; categoryId?: string | null; apps?: string[] },
  ): Promise<{ channel: Channel }>
  /**
   * History, newest last. With no `opts` this is the live tail (the pod's own default page size).
   * `before` pages backwards from a message id already on screen — the pod resolves it against the
   * log itself, so the client never has to reconstruct a cursor from a timestamp.
   */
  messages(
    channelId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<{ messages: ChannelMessage[]; hasMore: boolean }>
  postMessage(channelId: string, text: string, threadId?: string): Promise<{ message: ChannelMessage }>
  markRead(channelId: string): Promise<{ ok: true }>
  openDm(userId: string): Promise<{ channel: Channel; created: boolean }>
  createCategory(name: string): Promise<{ category: Category; created: boolean }>
  deleteCategory(categoryId: string): Promise<{ deleted: string }>
  directory(): Promise<Directory>
  profile(): Promise<{ profile: MemberProfile | null }>
  setProfile(patch: {
    handle?: string | null
    displayName?: string | null
  }): Promise<{ profile: MemberProfile }>
  /** The channel socket's URL, token included — `WebSocket` cannot set headers. */
  socketUrl(): Promise<string>
}

export function createTeamClient(transport: TeamTransport): TeamClient {
  async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await transport.getToken()
    const res = await fetch(`${transport.baseUrl}/api/team${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    })
    if (!res.ok) {
      let message = `Request failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        /* non-JSON error body — keep the status message */
      }
      throw new Error(message)
    }
    return (await res.json()) as T
  }

  const body = (value: unknown) => ({ body: JSON.stringify(value) })

  return {
    channels: () => call('/channels'),
    createChannel: (name, categoryId) =>
      call('/channels', { method: 'POST', ...body({ name, ...(categoryId ? { categoryId } : {}) }) }),
    patchChannel: (channelId, patch) =>
      call(`/channels/${channelId}`, { method: 'PATCH', ...body(patch) }),
    messages: (channelId, opts) => {
      const params = new URLSearchParams()
      if (opts?.limit) params.set('limit', String(opts.limit))
      if (opts?.before) params.set('before', opts.before)
      const qs = params.toString()
      return call(`/channels/${channelId}/messages${qs ? `?${qs}` : ''}`)
    },
    postMessage: (channelId, text, threadId) =>
      call(`/channels/${channelId}/messages`, {
        method: 'POST',
        ...body({ text, ...(threadId ? { threadId } : {}) }),
      }),
    markRead: (channelId) => call(`/channels/${channelId}/read`, { method: 'POST' }),
    openDm: (userId) => call('/dms', { method: 'POST', ...body({ userId }) }),
    createCategory: (name) => call('/categories', { method: 'POST', ...body({ name }) }),
    deleteCategory: (categoryId) => call(`/categories/${categoryId}`, { method: 'DELETE' }),
    directory: () => call('/directory'),
    profile: () => call('/profile'),
    setProfile: (patch) => call('/profile', { method: 'PUT', ...body(patch) }),

    async socketUrl() {
      const token = await transport.getToken()
      // Absolute base (native) or same-origin (web) — derived from the same
      // `baseUrl` the REST calls use, so the two can never point at different
      // pods. `ws:`/`wss:` is chosen from whichever scheme that base implies.
      const base = transport.baseUrl || globalThis.window?.location?.origin || ''
      const wsBase = base.replace(/^http/, 'ws')
      return `${wsBase}/api/team/ws?t=1&access_token=${encodeURIComponent(token)}`
    },
  }
}
