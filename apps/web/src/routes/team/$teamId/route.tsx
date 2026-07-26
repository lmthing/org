import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router'
import { AppProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'
import { WakingScreen } from '@/lib/waking-screen'
import { TeamAuthProvider, useTeamAuth } from '@/lib/team-auth'
import { teamComputeBase } from '@/lib/team-api'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * `/team/$teamId` — everything below here talks to the TEAM's pod rather than
 * the member's own.
 *
 * Three layers, in this order and for these reasons:
 *
 *  1. `TeamAuthProvider` mints the team-scoped token and blocks until it has
 *     one — the pod transport reads its token synchronously, so mounting the
 *     tree earlier would send the first request with no credential.
 *  2. `PodEnsureGate` provisions/wakes the team's pod. Its control-plane calls
 *     go to `/api/teams/:id/compute/*` with the PERSONAL token (the gateway
 *     checks membership); its same-origin edge probes carry the TEAM token,
 *     because Envoy routes lmthing.team by the `team` claim.
 *  3. `AppProvider` points `@lmthing/state` at the same origin with the team
 *     token, which is what makes every existing project/space component work
 *     against the team's workspace without changes.
 */
function TeamWorkspace() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  return (
    <TeamAuthProvider teamId={teamId} fallback={<WakingScreen mode="signing-in" />}>
      <TeamPod />
    </TeamAuthProvider>
  )
}

function TeamPod() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const { getAccessToken, refreshAuth } = useAuth()
  const team = useTeamAuth()

  return (
    <PodEnsureGate
      target={{
        base: teamComputeBase(teamId),
        getToken: getAccessToken,
        edgeToken: team.getTeamToken,
      }}
    >
      <AppProvider
        pod={{
          // Same origin as this surface: lmthing.team's Envoy /api proxy carries
          // it into the team's pod.
          podBaseUrl: COMPUTER_BASE_URL,
          getAccessToken: () => team.teamTokenSync() ?? '',
          refresh: refreshAuth,
        }}
      >
        <TeamChrome />
      </AppProvider>
    </PodEnsureGate>
  )
}

const TABS = [
  { to: '/team/$teamId/channels', label: 'Channels' },
  { to: '/team/$teamId/projects', label: 'Projects' },
  { to: '/team/$teamId/members', label: 'Members' },
  { to: '/team/$teamId/settings', label: 'Settings' },
] as const

function TeamChrome() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const team = useTeamAuth()
  return (
    <Prim.Col height="100%">
      <Prim.Row
        alignItems="center"
        gap="$4"
        paddingHorizontal="$4"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderColor="$border"
      >
        <Link to="/team">
          <Prim.Text fontSize="$sm" color="$muted-foreground">
            ← Teams
          </Prim.Text>
        </Link>
        {TABS.map((tab) => (
          <Link key={tab.to} to={tab.to} params={{ teamId }}>
            <Prim.Text fontSize="$sm">{tab.label}</Prim.Text>
          </Link>
        ))}
        <Prim.Box flex={1} />
        {/* The role is the member's own, read from the token they hold. The
            server enforces it regardless; this only explains the UI. */}
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {team.role}
        </Prim.Text>
      </Prim.Row>
      <Prim.Box flex={1} overflow="hidden">
        <Outlet />
      </Prim.Box>
    </Prim.Col>
  )
}

export const Route = createFileRoute('/team/$teamId')({
  component: TeamWorkspace,
})
