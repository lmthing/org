/**
 * Caller identity and role gating for a TEAM pod.
 *
 * A user's pod is single-tenant: it has no authentication of its own and is safe
 * because only its owner can ever be routed to it. A team's pod is reached by
 * every member, so it needs to know who is calling and what they may do.
 *
 * That identity arrives as request headers, projected from the validated
 * team-scoped JWT by Envoy's `claimToHeaders` (devops/argocd/envoy/team-policies.yaml).
 * They cannot be spoofed: the JWT filter overwrites any same-named header the
 * client sent, and the only network path to a pod is through the edge. The pod
 * therefore trusts these headers absolutely — which is exactly why this module
 * refuses to run at all unless the gateway marked this pod as a team pod.
 *
 * `LMTHING_TEAM_MODE` is set as a CONTAINER env var by the gateway, not as a key
 * in the editable `user-env` secret, so an editor cannot turn the guard off with
 * a replace-all `PUT /api/compute/env`.
 *
 * The roles come from design/teams.md:
 *   viewer — use the team's spaces and apps, read the projects, chat with THING.
 *   editor — all of that, plus editing projects and spaces and configuring the team.
 */

import type { IncomingMessage } from 'node:http';

export type TeamRole = 'viewer' | 'editor';

export interface TeamCaller {
  userId: string;
  email: string;
  teamId: string;
  role: TeamRole;
}

/** True when the gateway provisioned this pod for a team. */
export function isTeamMode(): boolean {
  return process.env['LMTHING_TEAM_MODE'] === '1';
}

function headerOf(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? '') : '';
}

/**
 * The verified caller, or null outside team mode / when the edge did not supply
 * one. Envoy rejects a request with no team claim before it reaches us, so a
 * missing header here means team mode is on but the request bypassed the edge —
 * which we treat as no identity at all rather than guessing.
 */
export function readCaller(req: IncomingMessage): TeamCaller | null {
  if (!isTeamMode()) return null;
  const userId = headerOf(req, 'x-user-id');
  const teamId = headerOf(req, 'x-team-id');
  const role = headerOf(req, 'x-lmthing-role');
  if (!userId || !teamId) return null;
  if (role !== 'viewer' && role !== 'editor') return null;
  return { userId, teamId, role, email: headerOf(req, 'x-user-email') };
}

/**
 * Mutating requests a VIEWER may still make. Everything else that mutates is
 * refused, so a route added later is denied to viewers until someone decides
 * otherwise — the safe direction for a default.
 *
 * Each entry is anchored and matched against the URL path only.
 */
const VIEWER_ALLOWED: ReadonlyArray<{ method: string; path: RegExp; why: string }> = [
  // Chatting with THING is a viewer's right, and a chat needs a session to run in.
  { method: 'POST', path: /^\/api\/sessions$/, why: 'chat with THING' },
  // Sub-routes of a session the caller owns (messages, forms, cancel). Ownership
  // is enforced separately by the session routes; this only permits the shape.
  { method: '*', path: /^\/api\/sessions\/[^/]+(\/.*)?$/, why: 'drive an own session' },
  // Talking in a channel — the point of the team chat surface.
  { method: 'POST', path: /^\/api\/team\/channels\/[^/]+\/messages$/, why: 'post to a channel' },
  { method: 'POST', path: /^\/api\/team\/channels\/[^/]+\/read$/, why: 'mark a channel read' },
  // Attachments for those messages, and the keep-warm ping.
  { method: 'POST', path: /^\/api\/uploads$/, why: 'attach a file to a message' },
  { method: 'POST', path: /^\/api\/keepalive$/, why: 'keep the workspace warm' },
  { method: 'POST', path: /^\/api\/report-bug$/, why: 'report a bug' },
  // "Use the team's apps": a project-app's own API. What the app does internally
  // is the app's business — its data model is not the team's project source.
  { method: '*', path: /^\/app\/[^/]+\/api(\/.*)?$/, why: "use an app's API" },
  { method: '*', path: /^\/[^/]+\/api(\/.*)?$/, why: "use an app's API (root mount)" },
];

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Paths served WITHOUT a caller, even in team mode.
 *
 * The kubelet's startup probe is the reason this exists. It comes from inside
 * the cluster, not through Envoy, so it carries no identity headers — and a
 * team pod that 401s its own probe never becomes ready and crash-loops forever.
 * A probe target must therefore be reachable by an anonymous in-cluster caller,
 * which means it must disclose nothing: `/api/health` answers a bare 200.
 *
 * Nothing else belongs here. Adding a path is granting the whole cluster
 * unauthenticated access to it.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/api/health']);

/** True for a path served without any caller identity — see PUBLIC_PATHS. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export interface GuardDecision {
  ok: boolean;
  /** Set when ok — the verified caller, to stamp onto whatever the request creates. */
  caller?: TeamCaller;
  status?: number;
  error?: string;
}

/**
 * Decide whether a request may proceed. Outside team mode this always allows:
 * a personal pod behaves exactly as it did before teams existed.
 */
export function guardRequest(req: IncomingMessage, pathname: string): GuardDecision {
  if (!isTeamMode()) return { ok: true };
  // The kubelet probes this one anonymously, from inside the cluster.
  if (isPublicPath(pathname)) return { ok: true };

  const caller = readCaller(req);
  if (!caller) {
    return {
      ok: false,
      status: 401,
      error: 'team workspace requires a team token',
    };
  }

  const method = (req.method ?? 'GET').toUpperCase();
  if (READ_ONLY_METHODS.has(method)) return { ok: true, caller };
  if (caller.role === 'editor') return { ok: true, caller };

  const allowed = VIEWER_ALLOWED.some(
    (rule) => (rule.method === '*' || rule.method === method) && rule.path.test(pathname),
  );
  if (allowed) return { ok: true, caller };

  return {
    ok: false,
    status: 403,
    caller,
    error: 'viewers cannot change this team workspace',
  };
}

/** WebSocket paths a viewer may open. The terminal is an editor tool. */
export function guardWebSocket(req: IncomingMessage, pathname: string): GuardDecision {
  if (!isTeamMode()) return { ok: true };

  const caller = readCaller(req);
  if (!caller) {
    return { ok: false, status: 401, error: 'team workspace requires a team token' };
  }
  if (caller.role === 'editor') return { ok: true, caller };

  // A terminal is unrestricted shell access to the team's workspace — the one
  // socket a viewer must not get.
  if (/^\/api\/terminals\//.test(pathname)) {
    return { ok: false, status: 403, caller, error: 'viewers cannot open a terminal' };
  }
  return { ok: true, caller };
}
