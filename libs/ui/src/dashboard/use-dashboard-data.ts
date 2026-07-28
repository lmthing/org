import * as React from 'react'
import { authHeaders } from '../chat/app/auth'
import { apiUrl } from '../platform/api-base'
import { dataPlaneOrigin } from '../lib/app-urls'

/**
 * The data behind the Home dashboard, from the three places it actually lives.
 *
 * This is deliberately ONE hook rather than three, because the dashboard's job is to be a single
 * coherent answer to "what have I got?" — and the three sources fail independently. A user with no
 * teams, an unreachable gateway and a warm pod should still get their conversations, so each source
 * settles on its own and an error in one never blanks the others.
 *
 * ### Where each piece comes from, and why it is not all one call
 *
 * - **Teams live on the GATEWAY** (`lmthing.cloud/api/teams`), not on the pod: a team is an
 *   account-level object that exists before any pod does. `dataPlaneOrigin('cloud')` resolves that
 *   origin on both targets — on native `import.meta.env` is empty, so it returns the production
 *   gateway, which is the same absolute-URL story `apiUrl` tells for the pod.
 * - **Projects and conversations live on the POD**, reached through `apiUrl` so the call is relative
 *   on web and absolute on native.
 *
 * ### Why the conversation list costs a request per project
 *
 * `GET /api/sessions` returns only what is LIVE in memory and carries no title. `GET
 * /api/session-ledger` spans every project in one call and looked like the obvious answer — but its
 * `title` is usually empty, and a device run rendered the whole list as "Untitled conversation"
 * while the chat sidebar showed real names for the very same sessions. A list you cannot read is
 * not a shortcut. So Home reads the same source the sidebar does, `GET /api/projects/:id/sessions`,
 * once per project and bounded, and pays the extra requests for names people recognise.
 */

/** A team as the gateway lists it. Channels and unread counts live on the TEAM's own pod, which
 *  the dashboard deliberately does not wake — see `DashboardHome`. */
export interface DashboardTeam {
  id: string
  name: string
  role: 'viewer' | 'editor'
}

/** A pending invitation — the one genuinely ACTIONABLE thing the gateway returns. */
export interface DashboardInvite {
  id: string
  teamId: string
  teamName: string
  role: string
}

export interface DashboardProject {
  id: string
  name: string
}

export interface DashboardConversation {
  sessionId: string
  projectId?: string
  title?: string
  /** Millis. `endedAt` when the run finished, else when it started. */
  activityAt: number
  status: 'running' | 'done' | 'error'
}

export interface DashboardData {
  teams: DashboardTeam[]
  invites: DashboardInvite[]
  projects: DashboardProject[]
  conversations: DashboardConversation[]
  /** True until every source has settled — used for a skeleton, never to blank the whole screen. */
  loading: boolean
  /** Sources that failed, by name, so the surface can say so instead of showing a silent zero. */
  failed: string[]
  reload: () => void
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return (await res.json()) as T
}

/** How many projects Home will read conversations from. See the comment at the call site. */
const MAX_PROJECTS_SCANNED = 6

/** The persisted shape — this is the one that carries `title`. */
interface PersistedSession {
  sessionId: string
  projectId?: string
  title?: string
  lastActivity: number
  status?: string
}

export function useDashboardData(): DashboardData {
  const [teams, setTeams] = React.useState<DashboardTeam[]>([])
  const [invites, setInvites] = React.useState<DashboardInvite[]>([])
  const [projects, setProjects] = React.useState<DashboardProject[]>([])
  const [conversations, setConversations] = React.useState<DashboardConversation[]>([])
  const [pending, setPending] = React.useState(3)
  const [failed, setFailed] = React.useState<string[]>([])
  const [nonce, setNonce] = React.useState(0)

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])

  React.useEffect(() => {
    let live = true
    setPending(3)
    setFailed([])

    /** Settles one source without letting its failure touch the other two. */
    const settle = (name: string, run: () => Promise<void>) => {
      void run()
        .catch(() => {
          if (live) setFailed((f) => (f.includes(name) ? f : [...f, name]))
        })
        .finally(() => {
          if (live) setPending((p) => p - 1)
        })
    }

    settle('teams', async () => {
      const data = await getJson<{ teams?: DashboardTeam[]; invites?: Array<{ id: string; team_id: string; team_name: string; role: string }> }>(
        `${dataPlaneOrigin('cloud')}/api/teams`,
      )
      if (!live) return
      setTeams(data.teams ?? [])
      setInvites(
        (data.invites ?? []).map((i) => ({ id: i.id, teamId: i.team_id, teamName: i.team_name, role: i.role })),
      )
    })

    settle('projects', async () => {
      const data = await getJson<{ projects?: Array<{ id: string; name: string }> }>(apiUrl('/api/projects'))
      if (!live) return
      // `system` is a synthetic entry for the shipped system spaces, not somewhere a person works.
      setProjects((data.projects ?? []).filter((p) => p.id !== 'system').map((p) => ({ id: p.id, name: p.name })))
    })

    settle('conversations', async () => {
      // Titles come from the PERSISTED per-project list, not the ledger. The ledger spans projects
      // in one call, which is why it looked like the right source, but its `title` is usually empty
      // — a device run showed every row as "Untitled conversation" while the chat sidebar, reading
      // the persisted list, had real titles for the same sessions. A list of untitled rows is
      // useless for resuming, so this pays for a request per project to get names.
      const projectList = await getJson<{ projects?: Array<{ id: string }> }>(apiUrl('/api/projects'))
      const ids = (projectList.projects ?? []).map((p) => p.id).filter((id) => id !== 'system')
      // Bounded so a user with many projects does not open Home into a request storm; the tail is
      // not worth it when only the most recent handful are ever shown.
      const scanned = ids.slice(0, MAX_PROJECTS_SCANNED)
      const perProject = await Promise.all(
        scanned.map((id) =>
          getJson<{ sessions?: PersistedSession[] }>(apiUrl(`/api/projects/${id}/sessions`))
            .then((r) => (r.sessions ?? []).map((s) => ({ ...s, projectId: s.projectId ?? id })))
            // One unreadable project must not cost the others their conversations.
            .catch(() => [] as PersistedSession[]),
        ),
      )
      if (!live) return
      setConversations(
        perProject
          .flat()
          .map((s) => ({
            sessionId: s.sessionId,
            projectId: s.projectId,
            title: s.title,
            activityAt: s.lastActivity,
            status: s.status === 'running' ? ('running' as const) : ('done' as const),
          }))
          .sort((a, b) => b.activityAt - a.activityAt),
      )
    })

    return () => {
      live = false
    }
  }, [nonce])

  return { teams, invites, projects, conversations, loading: pending > 0, failed, reload }
}
