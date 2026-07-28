import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import { useAuth } from '@lmthing/auth'
import { crossAppOrigin } from '../lib/app-urls'
import { openUrl } from '../platform/navigation'
import {
  useDashboardData,
  type DashboardConversation,
  type DashboardProject,
  type DashboardTeam,
} from './use-dashboard-data'

/**
 * Home — the landing surface, shared by `apps/mobile` and the unified web app.
 *
 * ## What it is for
 *
 * The product is three things a person moves between — their conversations with THING, the projects
 * they build, and the teams they belong to — and until now the first screen was whichever of the
 * three the domain happened to point at. Home is the one place that shows all three, so "where was
 * I?" is answered by looking rather than by navigating.
 *
 * ## The ordering is the design
 *
 * Sections run in descending order of how likely they are to be what you came for:
 *
 * 1. **Ask** — the single most common intent is "start a new conversation", so it is the first
 *    thing under the greeting and needs no navigation at all.
 * 2. **Invitations**, when any exist. They are rare, they expire, and they are the only thing here
 *    that goes stale if ignored — so they outrank everything below despite being the smallest.
 * 3. **Continue** — resuming beats starting fresh often enough to sit above browsing.
 * 4. **Teams**, then **Projects** — the browse case.
 *
 * Empty sections are omitted rather than rendered as empty shells, except when EVERYTHING is empty,
 * where a first-run welcome replaces the lot. A new user should not meet four empty headings.
 *
 * ## What it deliberately does not show
 *
 * No unread badges on teams. Unread state lives on each TEAM's own pod
 * (`GET /api/team/channels` → `unread`), so an honest badge would mean waking every team's pod on
 * every visit to Home — expensive, slow, and it would bill the user for opening a dashboard. A
 * count that is silently absent or stale is worse than no count, so there is none. When the gateway
 * can summarise unread state per team in the team LIST, this is where it goes.
 */

/**
 * Leave for the teams surface (`lmthing.team`), which this app does not host.
 *
 * Exported so a host shell's "Teams" affordance and this dashboard's team rows go to exactly one
 * place — the alternative is every call site knowing the origin scheme, which is how cross-surface
 * links drift apart. A no-op when no origin resolves (a local dev build with no team surface), which
 * is better than navigating somewhere that 404s.
 */
export function openTeamsSurface(teamId?: string): void {
  const origin = crossAppOrigin('team')
  if (!origin) return
  openUrl(teamId ? `${origin}/team/${teamId}` : `${origin}/team`)
}

/**
 * A conversation's display name. The title is an EMPTY STRING until the agent names the session
 * (`setSessionMeta`), not `undefined`, so `??` sails straight past it and renders a card with a
 * blank first line — which is how a real untitled session looked on the device.
 */
function conversationTitle(c: DashboardConversation): string {
  return c.title?.trim() || 'Untitled conversation'
}

/** Relative time, matching the chat sidebar's phrasing so the two never disagree on "3h ago". */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/**
 * A name short enough to greet someone with.
 *
 * `username` is frequently the full email address, so it cannot be trusted to be a name: greeting a
 * test account with its address rendered "Good morning,
 * mobile-device-test-2026-07-27@lmthing.test" across three lines and pushed the primary action off
 * the first screen. Take the local part, tidy separators, and give up gracefully rather than
 * shouting an identifier at someone.
 */
function friendlyName(username?: string | null, email?: string | null): string {
  const raw = username ?? email ?? ''
  const local = raw.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  if (!local) return 'there'
  // A long local part is an identifier, not a name — better no name than a wall of one.
  return local.length > 24 ? 'there' : local
}

function greeting(hour: number): string {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const SECTION_LABEL = {
  fontSize: '$xs',
  fontWeight: '$semibold',
  color: '$muted-foreground',
  letterSpacing: '$wide',
  marginBottom: '$2',
} as const

const CARD = {
  backgroundColor: '$card',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: '$radius-xl',
  paddingHorizontal: '$4',
  paddingVertical: '$3',
} as const

const ROW_BETWEEN = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '$2',
} as const

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Prim.Box marginBottom="$6">
      <Prim.Text {...SECTION_LABEL}>{label}</Prim.Text>
      <Prim.Col gap="$2">{children}</Prim.Col>
    </Prim.Box>
  )
}

export interface DashboardHomeProps {
  /** Start a new conversation. Home never owns navigation — the host surface does. */
  onNewChat?: () => void
  /** Open an existing conversation. */
  onOpenConversation?: (conversation: DashboardConversation) => void
  /** Open a project (studio). */
  onOpenProject?: (project: DashboardProject) => void
  /**
   * Open a team. Defaults to the canonical `lmthing.team` origin, because a team is a separate
   * surface rather than a route inside this one.
   */
  onOpenTeam?: (team: DashboardTeam) => void
  className?: string
}

export function DashboardHome({
  onNewChat,
  onOpenConversation,
  onOpenProject,
  onOpenTeam,
  className,
}: DashboardHomeProps) {
  const { username, session } = useAuth()
  const { teams, invites, projects, conversations, loading, failed, reload } = useDashboardData()

  const name = friendlyName(username, session?.email)
  const recent = conversations.slice(0, 5)
  const isEmpty = !loading && teams.length === 0 && projects.length === 0 && conversations.length === 0

  // Teams are their own surface (`lmthing.team`), so the default is a cross-surface hop through the
  // navigation seam — a real browser hand-off on native, a location change on web. A host that CAN
  // route to a team internally passes `onOpenTeam` and this never runs.
  const openTeam = (team: DashboardTeam) => {
    if (onOpenTeam) return onOpenTeam(team)
    openTeamsSurface(team.id)
  }

  return (
    // `Prim.Scroll`: Home is a list of everything you were doing, so it outgrows a phone screen
    // immediately — and on native a `Box` CLIPS instead of scrolling, so the projects section was
    // simply unreachable. Worse than invisible: a swipe over a conversation card was delivered as a
    // TAP, so trying to scroll navigated you into a chat.
    <Prim.Scroll className={className} flexGrow={1} flexShrink={1} flexBasis="0%" backgroundColor="$background">
      <Prim.Col paddingHorizontal="$4" paddingVertical="$6" gap="$2" maxWidth={768} width="100%" alignSelf="center">
        <Prim.Text fontFamily="$heading" fontSize="$2xl" fontWeight="$bold" color="$foreground">
          {greeting(new Date().getHours())}, {name}
        </Prim.Text>

        {/* 1 — Ask. The primary action, reachable without navigating anywhere. */}
        <Prim.Pressable
          onClick={onNewChat}
          marginTop="$4"
          marginBottom="$6"
          {...CARD}
          {...ROW_BETWEEN}
          backgroundColor="$muted"
          title="Start a new conversation"
          aria-label="Start a new conversation"
        >
          <Prim.Text flexGrow={1} flexShrink={1} flexBasis="0%" color="$muted-foreground" fontSize="$sm">
            Ask THING anything…
          </Prim.Text>
          <Prim.Text color="$primary" fontSize="$sm" fontWeight="$semibold">
            New
          </Prim.Text>
        </Prim.Pressable>

        {failed.length > 0 && (
          <Prim.Pressable
            onClick={reload}
            marginBottom="$4"
            {...CARD}
            borderColor="$destructive"
            title="Retry"
          >
            <Prim.Text fontSize="$sm" color="$destructive">
              Couldn’t load {failed.join(' or ')}. Tap to retry.
            </Prim.Text>
          </Prim.Pressable>
        )}

        {isEmpty && failed.length === 0 && (
          <Prim.Box {...CARD}>
            <Prim.Text fontSize="$sm" color="$muted-foreground">
              Nothing here yet. Start a conversation above — projects and teams you create will show
              up here.
            </Prim.Text>
          </Prim.Box>
        )}

        {/* 2 — Invitations. Rare, expiring, and the only thing here that decays if ignored. */}
        {invites.length > 0 && (
          <Section label="INVITATIONS">
            {invites.map((invite) => (
              <Prim.Pressable
                key={invite.id}
                onClick={() => openTeam({ id: invite.teamId, name: invite.teamName, role: 'viewer' })}
                {...CARD}
                {...ROW_BETWEEN}
                borderColor="$primary"
                title={`Open ${invite.teamName}`}
              >
                <Prim.Text flexGrow={1} flexShrink={1} flexBasis="0%" fontSize="$sm" color="$foreground">
                  {invite.teamName}
                </Prim.Text>
                <Prim.Text fontSize="$xs" color="$primary" fontWeight="$semibold">
                  Invited as {invite.role}
                </Prim.Text>
              </Prim.Pressable>
            ))}
          </Section>
        )}

        {/* 3 — Continue. */}
        {recent.length > 0 && (
          <Section label="CONTINUE">
            {recent.map((c) => (
              <Prim.Pressable
                key={c.sessionId}
                onClick={() => onOpenConversation?.(c)}
                {...CARD}
                {...ROW_BETWEEN}
                title={conversationTitle(c)}
              >
                <Prim.Col flexGrow={1} flexShrink={1} flexBasis="0%" gap="$0.5">
                  <Prim.Text
                    fontSize="$sm"
                    color="$foreground"
                    whiteSpace="nowrap"
                    textOverflow="ellipsis"
                    overflow="hidden"
                  >
                    {conversationTitle(c)}
                  </Prim.Text>
                  <Prim.Text fontSize="$xs" color="$muted-foreground">
                    {relativeTime(c.activityAt)}
                    {c.projectId ? ` · ${c.projectId}` : ''}
                  </Prim.Text>
                </Prim.Col>
                {c.status === 'running' && (
                  <Prim.Text fontSize="$xs" color="$agent" fontWeight="$medium">
                    running
                  </Prim.Text>
                )}
              </Prim.Pressable>
            ))}
          </Section>
        )}

        {/* 4 — Browse. */}
        {teams.length > 0 && (
          <Section label="TEAMS">
            {teams.map((team) => (
              <Prim.Pressable
                key={team.id}
                onClick={() => openTeam(team)}
                {...CARD}
                {...ROW_BETWEEN}
                title={`Open ${team.name}`}
              >
                <Prim.Text flexGrow={1} flexShrink={1} flexBasis="0%" fontSize="$sm" color="$foreground">
                  {team.name}
                </Prim.Text>
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  {team.role}
                </Prim.Text>
              </Prim.Pressable>
            ))}
          </Section>
        )}

        {projects.length > 0 && (
          <Section label="PROJECTS">
            {projects.map((project) => (
              <Prim.Pressable
                key={project.id}
                onClick={() => onOpenProject?.(project)}
                {...CARD}
                {...ROW_BETWEEN}
                title={`Open ${project.name}`}
              >
                <Prim.Text flexGrow={1} flexShrink={1} flexBasis="0%" fontSize="$sm" color="$foreground">
                  {project.name}
                </Prim.Text>
              </Prim.Pressable>
            ))}
          </Section>
        )}
      </Prim.Col>
    </Prim.Scroll>
  )
}
