/**
 * Typed client for the team control plane (`/api/teams/*` on the gateway).
 *
 * These calls carry the user's PERSONAL token — they are about which teams you
 * belong to. Talking to a team's pod is the separate, team-scoped path in
 * `team-auth.tsx`.
 */

import { CLOUD_BASE_URL } from '@/lib/config'

export type TeamRole = 'viewer' | 'editor'

export interface TeamSummary {
  id: string
  name: string
  role: TeamRole
  created_at: string
}

export interface TeamInviteSummary {
  id: string
  team_id: string
  team_name: string
  role: TeamRole
  expires_at: string
}

export interface TeamMember {
  user_id: string
  email: string
  role: TeamRole
  created_at: string
}

export interface TeamDetail {
  id: string
  name: string
  created_at: string
  role: TeamRole
  members: TeamMember[]
  invites: Array<{ id: string; email: string; role: TeamRole; expires_at: string }>
}

export interface TeamBudgetWindow {
  duration: string
  max_budget: number
  /** `null` when LiteLLM has no per-window spend figure yet. */
  spend: number | null
}

export interface TeamBillingUsage {
  tier: string
  spend: number
  budgets: TeamBudgetWindow[]
  models: string[]
}

type Fetcher = (url: string, options?: RequestInit) => Promise<Response>

async function call<T>(
  authFetch: Fetcher,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await authFetch(`${CLOUD_BASE_URL}/api/teams${path}`, {
    ...options,
    headers: {
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

export const teamApi = {
  list: (f: Fetcher) =>
    call<{ teams: TeamSummary[]; invites: TeamInviteSummary[] }>(f, ''),

  create: (f: Fetcher, name: string) =>
    call<TeamSummary>(f, '', { method: 'POST', body: JSON.stringify({ name }) }),

  get: (f: Fetcher, teamId: string) => call<TeamDetail>(f, `/${teamId}`),

  rename: (f: Fetcher, teamId: string, name: string) =>
    call<{ id: string; name: string }>(f, `/${teamId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  addMember: (f: Fetcher, teamId: string, email: string, role: TeamRole) =>
    call<{ status: 'added' | 'invited'; email: string; role: TeamRole }>(
      f,
      `/${teamId}/members`,
      { method: 'POST', body: JSON.stringify({ email, role }) },
    ),

  setRole: (f: Fetcher, teamId: string, userId: string, role: TeamRole) =>
    call<{ user_id: string; role: TeamRole }>(f, `/${teamId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  removeMember: (f: Fetcher, teamId: string, userId: string) =>
    call<{ removed: string }>(f, `/${teamId}/members/${userId}`, { method: 'DELETE' }),

  revokeInvite: (f: Fetcher, teamId: string, inviteId: string) =>
    call<{ revoked: string }>(f, `/${teamId}/invites/${inviteId}`, { method: 'DELETE' }),

  acceptInvite: (f: Fetcher, inviteId: string) =>
    call<{ team_id: string; team_name: string | null; role: TeamRole }>(
      f,
      `/invites/${inviteId}/accept`,
      { method: 'POST' },
    ),

  getEnv: (f: Fetcher, teamId: string) =>
    call<{ vars: Record<string, string> }>(f, `/${teamId}/compute/env`),

  setEnv: (f: Fetcher, teamId: string, vars: Record<string, string>) =>
    call<{ ok: true }>(f, `/${teamId}/compute/env`, {
      method: 'PUT',
      body: JSON.stringify({ vars }),
    }),

  getBillingUsage: (f: Fetcher, teamId: string) =>
    call<TeamBillingUsage>(f, `/${teamId}/billing/usage`),

  startCheckout: (f: Fetcher, teamId: string, tier: string, returnUrl: string) =>
    call<{ client_secret: string }>(f, `/${teamId}/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ tier, return_url: returnUrl }),
    }),

  deleteTeam: (f: Fetcher, teamId: string) =>
    call<{ deleted: string }>(f, `/${teamId}`, { method: 'DELETE' }),
}

/** The gateway route prefix that provisions a team's pod (for PodEnsureGate). */
export function teamComputeBase(teamId: string): string {
  return `${CLOUD_BASE_URL}/api/teams/${teamId}/compute`
}
