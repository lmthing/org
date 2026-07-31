/**
 * Naming and dating, shared by every part of the surface so a member is never
 * called one thing in a message header and another in a picker.
 */

import type { Channel, MemberProfile } from './types'

/** Initials for an avatar fallback, derived from a name or email. */
export function initials(label: string): string {
  const cleaned = label.split('@')[0]!.replace(/[._-]+/g, ' ').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** "2m ago" / "3h ago" / a short date, for a millisecond timestamp. */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/**
 * The exact moment `relativeTime` only ever approximates — "3h ago" does not say whether that was
 * just before or after lunch. Used as a `title` (a mouse hover) on web and an `aria-label` (which
 * `nativeSafeProps` maps to `accessibilityLabel`) on native, so the precise timestamp is reachable
 * on both without adding a second visible line to every message.
 */
export function absoluteTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * What to call a member on screen, best first: the name they chose, the handle
 * others type, the email their token carried, then the raw id.
 *
 * Mirrors the pod's own `memberLabel` — the same order on both sides.
 */
export function memberLabel(member: MemberProfile | undefined, fallback = 'Someone'): string {
  if (!member) return fallback
  return member.displayName || (member.handle ? `@${member.handle}` : '') || member.email || fallback
}

/** The other participant of a DM, from the caller's point of view. */
export function dmPartner(channel: Channel, meId: string): string | undefined {
  return (channel.members ?? []).find((id) => id !== meId)
}

/** A named channel is its name; a DM is whoever it is with. */
export function channelTitle(
  channel: Channel | undefined,
  members: readonly MemberProfile[],
  meId: string,
): string {
  if (!channel) return 'Channels'
  if (channel.kind !== 'dm') return channel.name
  const partnerId = dmPartner(channel, meId)
  return memberLabel(
    members.find((m) => m.userId === partnerId),
    partnerId ?? 'Direct message',
  )
}
