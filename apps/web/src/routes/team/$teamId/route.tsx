import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, Link, Outlet, useNavigate, useLocation, useParams } from '@tanstack/react-router'
import { AppProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { TabBar } from '@lmthing/ui/elements/nav/tab-bar'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { ArrowLeft, Hash, FolderKanban, Users, Settings } from 'lucide-react'
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
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

function TeamChrome() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const team = useTeamAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const base = `/team/${teamId}`
  const activeTab = TABS.find((tab) => pathname.startsWith(`${base}/${tab.id}`))?.id ?? 'channels'

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
          <Prim.Row alignItems="center" gap="$1">
            <ArrowLeft size={14} aria-hidden={true} />
            <Prim.Text fontSize="$sm" color="$muted-foreground">
              Teams
            </Prim.Text>
          </Prim.Row>
        </Link>
        <Prim.Box flex={1}>
          <TabBar
            tabs={TABS.map((tab) => ({
              id: tab.id,
              label: (
                <Prim.Row alignItems="center" gap="$1.5">
                  <tab.icon size={14} aria-hidden={true} />
                  <Prim.Text fontSize="$sm">{tab.label}</Prim.Text>
                </Prim.Row>
              ),
            }))}
            activeTab={activeTab}
            onTabChange={(id) => void navigate({ to: `${base}/${id}` })}
            borderBottomWidth={0}
          />
        </Prim.Box>
        {/* The role is the member's own, read from the token they hold. The
            server enforces it regardless; this only explains the UI. */}
        <Badge variant={team.role === 'editor' ? 'primary' : 'muted'}>{team.role}</Badge>
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
