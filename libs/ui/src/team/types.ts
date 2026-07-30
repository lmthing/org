/**
 * The team surface's data, as both targets see it.
 *
 * Mirrors what the pod stores (`sdk/org/libs/cli/src/server/team-channels.ts`,
 * `team-members.ts`, `team-reads.ts`). Kept here rather than in either app so
 * there is one definition for the web adapter and the mobile shell — a type that
 * exists twice is a type that drifts.
 */

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
  | { type: 'thing_status'; channelId: string; threadId: string; status: string; activity?: string }
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

/** What the rail is showing. One at a time — see `rail.tsx`. */
export type Rail =
  | { kind: 'thread'; threadId: string }
  | { kind: 'app'; projectId: string }
  | null
