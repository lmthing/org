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
  ChannelAttachment,
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
  /**
   * `attachments` are files already staged by `uploadAttachment` below — only their `id`s cross
   * the wire (`attachmentIds`), mirroring the WS convention the personal chat surface's
   * `sendMessage` frame already uses (`libs/cli/src/server/ws/agent.ts`): the pod re-reads the
   * bytes/metadata from its own upload store rather than trusting whatever the client says about
   * them.
   */
  postMessage(
    channelId: string,
    text: string,
    threadId?: string,
    attachments?: ChannelAttachment[],
  ): Promise<{ message: ChannelMessage }>
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
  /**
   * Upload a file for a soon-to-be-sent message, and get back a staged ref the composer holds
   * until send. `data` is a `data:<mime>;base64,…` URL — the same encoding the personal chat
   * surface's `Composer` reads a `File` into (`FileReader`/`Buffer` differ across web and
   * native, base64 text does not).
   *
   * This is `POST /api/uploads`, reached directly rather than through `/api/team/*`: uploads are
   * not a team concept, they are the same store the personal pod uses, and `team-guard.ts`
   * already opens the route to a viewer ("attach a file to a message").
   */
  uploadAttachment(input: { filename?: string; mediaType: string; data: string }): Promise<ChannelAttachment>
  /**
   * Resolve a stored attachment's `url` into something an `<img>`/`<audio>`/`<a>` can load with
   * no `Authorization` header — `GET /api/uploads/:id` is authorized per-request (the owner, or a
   * member of a channel the upload was posted into, `routes/uploads.ts`), and none of those
   * elements can send a bearer token. The token rides as an `access_token` query param instead —
   * not a workaround: Envoy's `team-jwt` policy explicitly validates it from there
   * (`devops/argocd/envoy/team-policies.yaml`), the same mechanism `socketUrl` above already
   * relies on for the one other place this surface cannot set a header.
   *
   * Synchronous, off the most recently resolved token: every call above refreshes it, and by the
   * time any message — therefore any attachment — can be on screen, `channels()`/`messages()`/
   * `directory()`/`profile()` have already resolved one on mount. Falls back to the bare URL when
   * none has landed yet, the same degradation `chat/app/auth.ts#withAuthToken` uses with no token
   * at all, rather than throwing over a slow mint.
   */
  attachmentUrl(url: string): string
}

export function createTeamClient(transport: TeamTransport): TeamClient {
  // The most recently resolved token — kept only for `attachmentUrl` below, which has no async
  // path of its own (an `<img src>` needs a plain string, not a promise to await).
  let lastToken = ''
  async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await transport.getToken()
    lastToken = token
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
    postMessage: (channelId, text, threadId, attachments) =>
      call(`/channels/${channelId}/messages`, {
        method: 'POST',
        ...body({
          text,
          ...(threadId ? { threadId } : {}),
          ...(attachments?.length ? { attachmentIds: attachments.map((a) => a.id) } : {}),
        }),
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

    async uploadAttachment(input) {
      const token = await transport.getToken()
      lastToken = token
      const res = await fetch(`${transport.baseUrl}/api/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        let message = `Upload failed (${res.status})`
        try {
          const err = (await res.json()) as { error?: string }
          if (err.error) message = err.error
        } catch {
          /* non-JSON error body — keep the status message */
        }
        throw new Error(message)
      }
      return (await res.json()) as ChannelAttachment
    },

    attachmentUrl(url) {
      const resolved = `${transport.baseUrl}${url}`
      if (!lastToken) return resolved
      const sep = resolved.includes('?') ? '&' : '?'
      return `${resolved}${sep}access_token=${encodeURIComponent(lastToken)}`
    },
  }
}
