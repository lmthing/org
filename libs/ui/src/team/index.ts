/**
 * The team chat surface — one source, both targets.
 *
 * `apps/web` and `apps/mobile` each mount {@link TeamChannelsView} and supply
 * the three things that genuinely differ: how the pod is reached
 * ({@link createTeamClient}), where the channel and rail state lives (the URL on
 * web, component state on native), and where a project's pages are served.
 *
 * Everything else — the transcript, threads, the composer and its `@` picker, the
 * sidebar, unread, the app rail — is this package's, and neither app is allowed
 * to reach past this barrel to reimplement a piece of it
 * (`apps/mobile/scripts/lint-barrel-imports.mjs`).
 */

export { TeamChannelsView, type TeamChannelsViewProps } from './channels-view'
export { createTeamClient, type TeamClient, type TeamTransport } from './client'
export { useTeamChat, type TeamChat } from './use-team-chat'
export { useTeamLayout, type TeamLayout } from './use-layout'
export { absoluteTime, channelTitle, dmPartner, initials, memberLabel, relativeTime } from './format'
export type {
  Category,
  Channel,
  ChannelEvent,
  ChannelKind,
  ChannelMessage,
  ChannelUnread,
  Directory,
  DirectoryProject,
  MemberProfile,
  Rail,
} from './types'
