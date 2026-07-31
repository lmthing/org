import type { YieldRequest } from '../eval/yield.js';

/**
 * Team globals — THING's awareness of the team it is running inside.
 *
 * A team pod is a workspace several people share (see `libs/cli/src/server/team-guard.ts`).
 * Until these globals existed, an agent answering in a channel knew exactly one
 * thing about the team: the `[email in #channel] ` prefix `promptFor` glued onto
 * the message. It could not name a colleague, could not tell one channel from
 * another, could not read what the team decided last week, and could not say
 * anything anywhere except as the reply to the message that woke it.
 *
 * The surface splits along the line that matters — **reading the workspace** vs
 * **acting in it**:
 *
 *   - `team:read`  → `teamContext` / `teamMembers` / `teamChannels` / `teamHistory`
 *   - `team:post`  → `teamPost` / `teamPinApp` / `teamCreateChannel`
 *
 * `teamCreateChannel` sits under `team:post` rather than an id of its own because
 * it is the same authority: making a room the whole team can see, and speaking in
 * one, are both "leave something permanent in the shared workspace". A third id
 * would have to be intersected, dropped and documented everywhere the other two
 * are, and would separate two powers nobody wants separated.
 *
 * **There is deliberately no `teamDM`.** A `kind:'thing'` message carries no
 * `userId`, and `dmChannelId` hashes a sorted set of USER ids
 * (`libs/cli/src/server/team-channels.ts#dmChannelId`) — so THING, which has no id
 * of its own, cannot be a participant in a direct message. Every implementation of
 * "THING DMs Bo" is therefore one of two bad things: a DM sent as the asker (an
 * impersonation the rest of this module exists to prevent), or a DM that needs an
 * invented THING identity the addressing scheme has no room for. Reaching a person
 * goes through the mention path instead — `teamPost` resolves `@handle`s at write
 * time, which raises the badge and sends the push through machinery that already
 * works. If DMs from the agent are wanted later, they need a real THING principal
 * first, not a workaround here.
 *
 * Two ids, not one, because a read-only fork role keeps `team:read` and loses
 * `team:post` (`exec/capability.ts#intersectAppCaps`), and because a summarizing
 * agent that may look up who is in the team has no business broadcasting into a
 * channel or buzzing somebody's phone.
 *
 * **Nothing here exists on a personal pod.** The grants are dropped at parse time
 * unless the gateway marked this pod a team pod (`spaces/capabilities.ts#isTeamPod`),
 * so on a personal pod the globals are neither injected nor declared and a stray
 * `teamPost(...)` is a typecheck error the model can see and retry — the same
 * "not granted ⇒ not injected AND absent from the DTS" rule every other capability
 * runs on.
 *
 * **Identity is the CALLER's, never the agent's.** Every one of these resolves
 * against the {@link TeamResolver} the host built for THIS turn, closed over the
 * verified {@link TeamTurnInfo} the route read out of Envoy's headers. Sandbox
 * code cannot name a caller, a channel or a role: there is no parameter for it.
 * A message THING posts is a `thing` message and can never be attributed to a
 * member.
 *
 * Value-yielding (Promise-returning) like the store globals: the resolver lives
 * host-side in libs/cli (it is the only side that knows `<root>/.team/`), threaded
 * through the yield router as `YieldRouterContext.teamResolver` from
 * `AppGlobalImpls.team`. Absent ⇒ every call rejects with a clear error — which is
 * what a THING session outside a channel (Studio, /chat on a team pod) gets.
 */

/** The verified member whose message started this turn. */
export interface TeamCallerInfo {
  userId: string;
  email?: string;
  /** The `@`-typeable handle, when they have chosen one. */
  handle?: string;
  displayName?: string;
  /** A viewer may read the workspace; only an editor may act in it. */
  role: 'viewer' | 'editor';
}

/** Who asked, in which channel, in which thread — the turn's own coordinates. */
export interface TeamTurnInfo {
  teamId: string;
  channelId: string;
  channelName: string;
  channelKind: 'channel' | 'dm';
  /** The thread this turn is answering in, when the message opened or continued one. */
  threadId?: string;
  caller: TeamCallerInfo;
}

/** One row of the team's member directory. */
export interface TeamMemberInfo {
  userId: string;
  /** What to call them on screen — display name, else `@handle`, else email. */
  label: string;
  handle?: string;
  displayName?: string;
  email?: string;
  /** True for the member who started this turn. */
  isCaller: boolean;
}

/** A channel the CALLER can see (a DM they are not in is never listed). */
export interface TeamChannelInfo {
  id: string;
  name: string;
  kind: 'channel' | 'dm';
  categoryId?: string;
  /** Project ids whose app is pinned to this channel. */
  apps?: string[];
}

/** One message of a channel's history, flattened for reading. */
export interface TeamMessageInfo {
  id: string;
  ts: string;
  channelId: string;
  kind: 'user' | 'thing' | 'system';
  text: string;
  /** The directory label of whoever wrote it ('THING' for the agent's own posts). */
  author: string;
  userId?: string;
  threadId?: string;
}

/**
 * A page of a channel's log, plus enough about the read itself for the turn to
 * SAY what it read. A global that silently ingests a channel is not auditable —
 * "I read the last 30 messages of #design" is a sentence the agent can only write
 * if the host tells it the channel's name and how many messages came back.
 */
export interface TeamHistoryPage {
  messages: TeamMessageInfo[];
  /** More history exists before this page — page back with `before`. */
  hasMore: boolean;
  channelId: string;
  channelName: string;
  /** How many messages this page actually contains. */
  returned: number;
  /** The limit that was APPLIED, which may be lower than the one requested. */
  limit: number;
}

/** The outcome of a post — `messageId` identifies the stored message. */
export interface TeamPostResult {
  ok: boolean;
  channelId: string;
  messageId?: string;
  /** True when a receipt was left in the thread the turn is running in, because
   *  the post landed somewhere else. Say what you did; do not repeat the receipt. */
  receipt?: boolean;
}

export interface TeamPinResult {
  ok: boolean;
  channelId: string;
  /** The channel's pinned project ids after the pin. */
  apps: string[];
}

/**
 * The outcome of asking for a channel — the id is the point, because it is what
 * a following `teamPost` needs to say the first thing in there.
 *
 * `created:false` means a channel of that name was ALREADY there and this is it.
 * Creating is get-or-create rather than an error and rather than a second channel
 * with a suffixed id: two rooms about the same subject is the exact mess the
 * request was trying to end, and a name is the only handle anyone has on a
 * channel. The turn is told which of the two happened so it can say "there is
 * already a #x" instead of announcing something it did not make.
 */
export interface TeamCreateChannelResult {
  ok: boolean;
  channelId: string;
  /** The channel's display name — the STORED one, which on a collision is the existing channel's. */
  name: string;
  /** False when this channel already existed and was handed back unchanged. */
  created: boolean;
}

/**
 * Host resolver for the team globals — supplied by libs/cli
 * (`server/team-globals.ts#createTeamResolver`) on `AppGlobalImpls.team`,
 * bound to one turn's verified caller and channel. Absent ⇒ team yields reject.
 *
 * Every method enforces the caller's own reach: a DM the caller is not in is
 * invisible (not "forbidden" — indistinguishable from absent), and both write
 * methods refuse a viewer. The sandbox has no way to widen any of it.
 */
export interface TeamResolver {
  context(): Promise<TeamTurnInfo>;
  members(): Promise<TeamMemberInfo[]>;
  channels(): Promise<TeamChannelInfo[]>;
  history(channelId: string, opts?: { limit?: number; before?: string }): Promise<TeamHistoryPage>;
  post(channelId: string, text: string, opts?: { threadId?: string }): Promise<TeamPostResult>;
  pinApp(channelId: string, projectId: string): Promise<TeamPinResult>;
  createChannel(name: string, opts?: { categoryId?: string }): Promise<TeamCreateChannelResult>;
}

/** Every yield kind these globals push, so the router and the injector agree. */
export type TeamYieldKind =
  | 'teamContext'
  | 'teamMembers'
  | 'teamChannels'
  | 'teamHistory'
  | 'teamPost'
  | 'teamPinApp'
  | 'teamCreateChannel';

/** One value-yield of `kind` carrying `args` — the shared body of all six globals. */
function teamYield<T>(
  pushYield: (req: YieldRequest) => void,
  kind: TeamYieldKind,
  args: unknown[],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pushYield({
      kind,
      args,
      deferred: { resolve: resolve as (v: unknown) => void, reject },
      vmPromiseHandle: undefined,
    });
  });
}

/** `teamContext()` — who asked, where, in which thread. Gated on `team:read`. */
export function createTeamContextGlobal(
  pushYield: (req: YieldRequest) => void,
): () => Promise<TeamTurnInfo> {
  return function teamContext(): Promise<TeamTurnInfo> {
    return teamYield<TeamTurnInfo>(pushYield, 'teamContext', []);
  };
}

/** `teamMembers()` — the team's directory. Gated on `team:read`. */
export function createTeamMembersGlobal(
  pushYield: (req: YieldRequest) => void,
): () => Promise<TeamMemberInfo[]> {
  return function teamMembers(): Promise<TeamMemberInfo[]> {
    return teamYield<TeamMemberInfo[]>(pushYield, 'teamMembers', []);
  };
}

/** `teamChannels()` — the channels the CALLER can see. Gated on `team:read`. */
export function createTeamChannelsGlobal(
  pushYield: (req: YieldRequest) => void,
): () => Promise<TeamChannelInfo[]> {
  return function teamChannels(): Promise<TeamChannelInfo[]> {
    return teamYield<TeamChannelInfo[]>(pushYield, 'teamChannels', []);
  };
}

/** `teamHistory(channelId, opts?)` — a page of a channel's log. Gated on `team:read`. */
export function createTeamHistoryGlobal(
  pushYield: (req: YieldRequest) => void,
): (channelId: string, opts?: { limit?: number; before?: string }) => Promise<TeamHistoryPage> {
  return function teamHistory(
    channelId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<TeamHistoryPage> {
    return teamYield<TeamHistoryPage>(pushYield, 'teamHistory', [channelId, opts]);
  };
}

/** `teamPost(channelId, text, opts?)` — say something in a channel. Gated on `team:post`. */
export function createTeamPostGlobal(
  pushYield: (req: YieldRequest) => void,
): (channelId: string, text: string, opts?: { threadId?: string }) => Promise<TeamPostResult> {
  return function teamPost(
    channelId: string,
    text: string,
    opts?: { threadId?: string },
  ): Promise<TeamPostResult> {
    return teamYield<TeamPostResult>(pushYield, 'teamPost', [channelId, text, opts]);
  };
}

/** `teamPinApp(channelId, projectId)` — pin a project's app beside a channel. Gated on `team:post`. */
export function createTeamPinAppGlobal(
  pushYield: (req: YieldRequest) => void,
): (channelId: string, projectId: string) => Promise<TeamPinResult> {
  return function teamPinApp(channelId: string, projectId: string): Promise<TeamPinResult> {
    return teamYield<TeamPinResult>(pushYield, 'teamPinApp', [channelId, projectId]);
  };
}

/**
 * `teamCreateChannel(name, opts?)` — give a subject a room of its own. Gated on
 * `team:post`, editor callers only, and get-or-create on the slugified name.
 *
 * No `members` parameter: a named channel is visible to the whole team, and a
 * private conversation is a DM, whose participants are its id
 * (`libs/cli/src/server/team-channels.ts#dmChannelId`). "Create a channel only
 * these three can see" is a membership model this surface does not have, and
 * inventing one here would be inventing it for the product.
 */
export function createTeamCreateChannelGlobal(
  pushYield: (req: YieldRequest) => void,
): (name: string, opts?: { categoryId?: string }) => Promise<TeamCreateChannelResult> {
  return function teamCreateChannel(
    name: string,
    opts?: { categoryId?: string },
  ): Promise<TeamCreateChannelResult> {
    return teamYield<TeamCreateChannelResult>(pushYield, 'teamCreateChannel', [name, opts]);
  };
}
