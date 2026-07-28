/**
 * Typed client for the TEAM POD's own API (`/api/team/*`), same-origin.
 *
 * The sibling of `team-api.ts`, and deliberately separate from it: that one
 * talks to the gateway with the user's PERSONAL token about which teams they
 * belong to; this one talks to one team's pod with the TEAM-scoped token about
 * what is inside it. Mixing them would mean one module where half the calls take
 * a different credential to a different origin.
 */

import { APP_PATH_PREFIX } from '@/lib/config'
import type { TeamAuth } from '@/lib/team-auth'

export type ChannelKind = 'channel' | 'dm'

export interface Channel {
  id: string
  name: string
  createdBy: string
  createdAt: string
  kind?: ChannelKind
  /** For a DM: the user ids in it. The other one is who it is *with*. */
  members?: string[]
  categoryId?: string
  /** Project ids pinned to this channel — the tabs in its header. */
  apps?: string[]
}

export interface Category {
  id: string
  name: string
  order: number
}

export interface ChannelMessage {
  id: string
  ts: string
  channelId: string
  kind: 'user' | 'thing' | 'system'
  text: string
  /** THING's JSX answer, as `display()` descriptors. */
  blocks?: unknown[]
  userId?: string
  email?: string
  threadId?: string
  mentions?: string[]
  /** Set on the card posted when THING finishes building an app. */
  app?: { projectId: string; name: string }
}

export interface MemberProfile {
  userId: string
  email?: string
  handle?: string
  displayName?: string
  joinedAt: string
  updatedAt: string
}

export interface DirectoryProject {
  id: string
  name: string
  /** Whether it has pages — i.e. whether there is anything to open in the rail. */
  hasApp: boolean
}

export interface ChannelUnread {
  channelId: string
  /** Anything at all since this member last looked. */
  hasUnread: boolean
  /** Messages that NAMED them — exact, because a wrong count is worse than none. */
  mentions: number
}

export interface Directory {
  members: MemberProfile[]
  projects: DirectoryProject[]
}

/** Server → client socket frames. Mirrors `ws/team-channels.ts#ChannelEvent`. */
export type ChannelEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'thing_status'; channelId: string; threadId: string; status: string }
  | { type: 'typing'; channelId: string; userId: string; email?: string }
  | { type: 'channel'; channel: Channel }
  | { type: 'categories'; categories: Category[] }
  | {
      type: 'app_created'
      channelId: string
      threadId: string
      projectId: string
      name: string
      requestedBy?: string
    }

async function podFetch(
  team: TeamAuth,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await team.getTeamToken()
  return fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  })
}

async function call<T>(team: TeamAuth, path: string, options: RequestInit = {}): Promise<T> {
  const res = await podFetch(team, `/api/team${path}`, options)
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

export const teamPod = {
  /** Channels, their categories AND their unread state in one round trip — a
   *  sidebar that draws itself and then re-draws with badges on is worse to look
   *  at than one that waits. */
  channels: (t: TeamAuth) =>
    call<{ channels: Channel[]; categories: Category[]; unread: ChannelUnread[] }>(t, '/channels'),

  createChannel: (t: TeamAuth, name: string, categoryId?: string) =>
    call<{ channel: Channel; created: boolean }>(t, '/channels', {
      method: 'POST',
      ...body({ name, ...(categoryId ? { categoryId } : {}) }),
    }),

  patchChannel: (
    t: TeamAuth,
    channelId: string,
    patch: { name?: string; categoryId?: string | null; apps?: string[] },
  ) =>
    call<{ channel: Channel }>(t, `/channels/${channelId}`, {
      method: 'PATCH',
      ...body(patch),
    }),

  messages: (t: TeamAuth, channelId: string) =>
    call<{ messages: ChannelMessage[]; hasMore: boolean }>(t, `/channels/${channelId}/messages`),

  postMessage: (t: TeamAuth, channelId: string, text: string, threadId?: string) =>
    call<{ message: ChannelMessage }>(t, `/channels/${channelId}/messages`, {
      method: 'POST',
      ...body({ text, ...(threadId ? { threadId } : {}) }),
    }),

  markRead: (t: TeamAuth, channelId: string) =>
    call<{ ok: true }>(t, `/channels/${channelId}/read`, { method: 'POST' }),

  openDm: (t: TeamAuth, userId: string) =>
    call<{ channel: Channel; created: boolean }>(t, '/dms', { method: 'POST', ...body({ userId }) }),

  createCategory: (t: TeamAuth, name: string) =>
    call<{ category: Category; created: boolean }>(t, '/categories', {
      method: 'POST',
      ...body({ name }),
    }),

  deleteCategory: (t: TeamAuth, categoryId: string) =>
    call<{ deleted: string }>(t, `/categories/${categoryId}`, { method: 'DELETE' }),

  directory: (t: TeamAuth) => call<Directory>(t, '/directory'),

  profile: (t: TeamAuth) => call<{ profile: MemberProfile | null }>(t, '/profile'),

  setProfile: (t: TeamAuth, patch: { handle?: string | null; displayName?: string | null }) =>
    call<{ profile: MemberProfile }>(t, '/profile', { method: 'PUT', ...body(patch) }),
}

/**
 * What to call a member on screen, best first: the name they chose, the handle
 * others type, the email their token carried, then the raw id.
 *
 * Mirrors the pod's own `memberLabel` — the same order in both places, so a
 * member is not called one thing in a message header and another in a picker.
 */
export function memberLabel(member: MemberProfile | undefined, fallback = 'Someone'): string {
  if (!member) return fallback
  return member.displayName || (member.handle ? `@${member.handle}` : '') || member.email || fallback
}

/** The other participant of a DM, from the caller's point of view. */
export function dmPartner(channel: Channel, meId: string): string | undefined {
  return (channel.members ?? []).find((id) => id !== meId)
}

/**
 * Where an installed app is served.
 *
 * Production `lmthing.app` serves apps at the root; every other context reserves
 * the `/app/` prefix. Taken from the shared constant rather than written out
 * again here, so the rail and the rest of the app can never disagree about where
 * a project's pages live.
 */
export function appUrl(projectId: string): string {
  return `${APP_PATH_PREFIX}/${projectId}/`
}
