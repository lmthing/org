/**
 * App-capability parsing for agent `instruct.md` frontmatter (`capabilities:`).
 *
 * A `capabilities:` value is a YAML list whose entries are either a **bare
 * capability id** (full scope) or a **single-key map** carrying that
 * capability's config (narrowed scope):
 *
 * ```yaml
 * capabilities:
 *   - db:read: { tables: [sources, raw_items] }   # narrowed to named tables
 *   - db:write: { tables: [raw_items] }           # per-VERB scope
 *   - api:call: { allow: [webSearch, markRead] }  # allowlist IS the config (required)
 *   - connections:use: { providers: [google, slack] } # provider allowlist (required)
 *   - pages:write                                 # bare = full scope, no config
 * ```
 *
 * Validation is **fail-loud** (mirrors `validateKnowledgeOptionFrontmatter` in
 * `load.ts`: a module-level allow-list `Set` + an unknown-key throw): an unknown
 * capability id, an unknown config key, a `db:*` `tables` naming a table absent
 * from the project's `database/` (only when `knownTables` is supplied), a bare
 * `api:call` (its `allow` is required — there is no "call anything"), or a
 * config given to a bare-only cap all throw.
 */

export type CapabilityId =
  | 'db:read'
  | 'db:write'
  | 'db:schema'
  | 'pages:write'
  | 'views:write'
  | 'api:write'
  | 'hooks:write'
  | 'api:call'
  | 'connections:use'
  | 'knowledge:write'
  | 'project:manage'
  | 'store:read'
  | 'store:install'
  | 'events:emit'
  | 'fs:scratch'
  | 'fs:local:read'
  | 'fs:local:write'
  | 'browser:cdp'
  | 'team:read'
  | 'team:post';

/** Every recognized capability id. Unknown ids fail the space load. */
export const CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'db:read',
  'db:write',
  'db:schema',
  'pages:write',
  'views:write',
  'api:write',
  'hooks:write',
  'api:call',
  'connections:use',
  'knowledge:write',
  'project:manage',
  'store:read',
  'store:install',
  'events:emit',
  'fs:scratch',
  'fs:local:read',
  'fs:local:write',
  'browser:cdp',
  'team:read',
  'team:post',
]);

/**
 * The TEAM-ONLY capabilities. They exist as ids on every pod — a space file ships
 * unchanged to both kinds of pod, so declaring one must never fail the load — but
 * the GRANT is dropped by {@link parseCapabilities} unless this pod is a team pod.
 */
export const TEAM_CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'team:read',
  'team:post',
]);

/**
 * Grants that a TEAM pod must never hold, whatever an agent declares.
 *
 * The mirror image of {@link TEAM_CAPABILITY_IDS}: those are dropped OFF a team pod, these are
 * dropped ON one. A team pod is shared, and an agent in it can be prompted by anyone with write
 * access to a channel — so these would give that agent a path to one member's laptop: their
 * filesystem, and a browser logged into their accounts. That is a categorically different product
 * from "my own agent can see my own files", not a stronger version of it.
 *
 * `libs/cli/src/server/team-guard.ts#guardWebSocket` refuses `/api/host/ws` on a team pod as well.
 * Belt and braces on purpose: this half removes the globals AND their DTS declarations, so a call
 * is a typecheck error rather than a runtime refusal, and that half means there is no transport
 * even if a capability somehow survived.
 */
export const DESKTOP_ONLY_CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'fs:local:read',
  'fs:local:write',
  'browser:cdp',
]);

/**
 * True when the gateway provisioned this pod for a TEAM.
 *
 * The mirror of `libs/cli/src/server/team-guard.ts#isTeamMode`, duplicated rather
 * than imported because `@lmthing/core` never imports from `@lmthing/cli`. It reads
 * the same CONTAINER env var, which the gateway sets outside the editable `user-env`
 * secret — so an editor cannot grant their agents the team surface with a
 * `PUT /api/compute/env`.
 *
 * This is a deployment property, constant for the process lifetime, which is why it
 * is read from the environment rather than threaded: it describes the POD, not a
 * request. Nothing about a CALLER is ever read this way — that arrives per turn on
 * the resolver (`globals/team.ts#TeamResolver`).
 */
export function isTeamPod(): boolean {
  return process.env['LMTHING_TEAM_MODE'] === '1';
}

/** The three db verbs whose (optional) config narrows scope to `{ tables: [...] }`. */
export const DB_CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'db:read',
  'db:write',
  'db:schema',
]);

/**
 * Knowledge-write scope. A present `knowledge:write` cap lets an agent author knowledge
 * option files (`writeKnowledge`) into its OWN space by default; `spaces` is a future
 * allow-list of ADDITIONAL space keys it may write into. Only own-space is enforced today
 * — the runtime binds the write path to the running agent's space dir (see
 * `createWriteKnowledgeGlobal`); the `spaces` list is parsed and reserved for when
 * cross-space writes ship.
 */
function parseKnowledgeWriteConfig(config: unknown, ctx: ParseCapabilitiesCtx): { spaces?: string[] } {
  if (!isRecord(config)) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "knowledge:write" has an invalid config: expected a map like { spaces: [...] }`,
    );
  }
  const unknownKeys = Object.keys(config).filter((k) => k !== 'spaces');
  if (unknownKeys.length > 0) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "knowledge:write" has disallowed config key(s): ${unknownKeys.join(', ')}. Allowed key: spaces`,
    );
  }
  if (!('spaces' in config)) return {};
  const rawSpaces = config['spaces'];
  if (!Array.isArray(rawSpaces) || rawSpaces.some((s) => typeof s !== 'string')) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "knowledge:write" config "spaces" must be a list of space keys`,
    );
  }
  return { spaces: rawSpaces as string[] };
}

/** Authoring/store/event caps that are **bare-only** — a config payload is an error. */
const BARE_ONLY_CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'pages:write',
  'views:write',
  'api:write',
  'hooks:write',
  'project:manage',
  'store:read',
  'store:install',
  'events:emit',
  'fs:scratch',
  'fs:local:read',
  'fs:local:write',
  'browser:cdp',
  'team:read',
  'team:post',
]);

/**
 * The parsed capability model attached to a loaded agent. A present key means
 * the cap is GRANTED; its value carries the (optional) scope narrowing:
 *   - `db:*`         → `{ tables?: string[] }` (omitted `tables` = all tables)
 *   - `api:call`     → `{ allow: string[] }` (always present — required)
 *   - `connections:use` → `{ providers: string[] }` (always present — required)
 *   - `knowledge:write` → `{ spaces?: string[] }` (omitted = own space only; the
 *                      `spaces` allow-list is reserved for cross-space writes — not
 *                      yet enforced, own-space is bound host-side)
 *   - authoring      → `true` (bare, no config)
 *   - project:manage → `true` (bare; grants createProject/selectProject — the
 *                      appbuilder's authority to scaffold/select a catalog app)
 *   - store:read     → `true` (bare; grants storeSearch/storeInspect — catalog discovery)
 *   - store:install  → `true` (bare; grants the consent-marked installSpace)
 *   - events:emit    → `true` (bare; grants emitEvent — publish the OWN scope's
 *                      declared events into the hook pipeline)
 *   - team:read      → `true` (bare; TEAM PODS ONLY — grants teamContext/teamMembers/
 *                      teamChannels/teamHistory. Dropped on a personal pod, so the
 *                      globals are neither injected nor declared there.)
 *   - team:post      → `true` (bare; TEAM PODS ONLY — grants teamPost/teamPinApp/
 *                      teamCreateChannel: every way a turn changes the shared workspace,
 *                      under ONE id. A separate id from `team:read` because writing into
 *                      a channel leaves a permanent record and raises other people's
 *                      badges, where reading discloses only what the caller already sees;
 *                      the split is what lets a read-only fork role keep the readers.)
 *   - fs:scratch     → `true` (bare; grants createScratch + a sandboxed generic
 *                      fs/shell surface rooted at a throwaway .lmthing/scratch dir —
 *                      the engineer's code sandbox. The ONLY grant that earns any
 *                      generic filesystem access; every other agent persists via the
 *                      typed writeProject* / architect builder functions.)
 */
export interface AppCapabilities {
  'db:read'?: { tables?: string[] };
  'db:write'?: { tables?: string[] };
  'db:schema'?: { tables?: string[] };
  'pages:write'?: true;
  /**
   * The SPEC-view writers — `writeProjectView` / `writeProjectViewComponent` /
   * `writeProjectShell` (`system-viewbuilder`). Deliberately a SEPARATE id from
   * `pages:write` rather than a share of it: the whole guarantee of that builder is that its
   * UI is 100% spec and therefore renders natively with no WebView, and the mechanism for
   * that guarantee is capability absence — an agent holding `views:write` and NOT
   * `pages:write` has no `writeProjectPage`/`writeProjectComponent` injected and none in its
   * DTS, so freehand TSX is a typecheck error rather than a rule it is asked to respect.
   * Folding the spec writers into `pages:write` would hand every one of those agents the TSX
   * writers back and dissolve the guarantee.
   */
  'views:write'?: true;
  'api:write'?: true;
  'hooks:write'?: true;
  'api:call'?: { allow: string[] };
  'connections:use'?: { providers: string[] };
  'knowledge:write'?: { spaces?: string[] };
  'project:manage'?: true;
  'store:read'?: true;
  'store:install'?: true;
  'events:emit'?: true;
  'fs:scratch'?: true;
  /**
   * Read files from folders the PERSON granted the LMThing desktop app — their own machine, not
   * the pod's disk. Reached over the desktop bridge (`libs/cli/src/rpc/host-bridge.ts`).
   *
   * Two ids rather than one, for the reason `intersectAppCaps` already gives for the team surface:
   * a single `fs:local` would have to be kept whole for a read-only fork (arming it with writers)
   * or dropped whole (blinding it). A read-only `explore`/`plan` fork examining a local repository
   * is the single most obvious use of this feature, so the split is the difference between it
   * working and it being unusable.
   *
   * The grant list is the PERSON'S and lives on their machine; it is deliberately not configurable
   * from frontmatter, so an agent can neither narrow nor WIDEN its own scope.
   */
  'fs:local:read'?: true;
  /** As `fs:local:read`, plus creating and modifying files in a grant marked read-write. */
  'fs:local:write'?: true;
  /**
   * RAW Chrome DevTools Protocol against the browser the LMThing desktop app is showing.
   *
   * The sharpest capability in the system, and gated hardest because of it. `Runtime.evaluate` on
   * an arbitrary target is total account takeover of every site the person is signed into, and
   * `Network.*` reads every request body including bearer tokens — so unlike the 27 curated
   * `system-browser` functions, this one is ALSO routed through the host-enforced consent gate
   * (`CONSENT_MARKED_YIELD_KINDS`), which fails closed where there is no prompter.
   *
   * Desktop-only: dropped on a team pod alongside `fs:local:*`.
   */
  'browser:cdp'?: true;
  'team:read'?: true;
  'team:post'?: true;
}

export interface ParseCapabilitiesCtx {
  /** Agent slug, for actionable error messages. */
  agentId: string;
  /**
   * Table names known to the resolving project's `database/`. When provided,
   * a `db:*` cap whose `tables` names an unknown table fails loud. When
   * **undefined** (a bare cap on a system / project-agnostic space) the table
   * existence check is DEFERRED to the project the space resolves into.
   */
  knownTables?: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse + validate a `db:*` config payload into `{ tables?: string[] }`. */
function parseDbConfig(
  id: CapabilityId,
  config: unknown,
  ctx: ParseCapabilitiesCtx,
): { tables?: string[] } {
  if (!isRecord(config)) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "${id}" has an invalid config: expected a map like { tables: [...] }`,
    );
  }
  const unknownKeys = Object.keys(config).filter((k) => k !== 'tables');
  if (unknownKeys.length > 0) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "${id}" has disallowed config key(s): ${unknownKeys.join(', ')}. Allowed key: tables`,
    );
  }
  if (!('tables' in config)) return {};

  const rawTables = config['tables'];
  if (!Array.isArray(rawTables) || rawTables.some((t) => typeof t !== 'string')) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "${id}" config "tables" must be a list of table names`,
    );
  }
  const tables = rawTables as string[];

  // Table-existence check only where a project context exists; a bare cap on a
  // project-agnostic system space (knownTables undefined) DEFERS this check.
  if (ctx.knownTables !== undefined) {
    const known = new Set(ctx.knownTables);
    const missing = tables.filter((t) => !known.has(t));
    if (missing.length > 0) {
      throw new Error(
        `Agent "${ctx.agentId}" capability "${id}" names table(s) not in the project's database/: ${missing.join(', ')}. Known tables: ${ctx.knownTables.length ? ctx.knownTables.join(', ') : '(none)'}`,
      );
    }
  }

  return { tables };
}

/** Parse + validate an `api:call` config payload into `{ allow: string[] }`. */
function parseApiCallConfig(config: unknown, ctx: ParseCapabilitiesCtx): { allow: string[] } {
  if (!isRecord(config)) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "api:call" has an invalid config: expected a map like { allow: [...] }`,
    );
  }
  const unknownKeys = Object.keys(config).filter((k) => k !== 'allow');
  if (unknownKeys.length > 0) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "api:call" has disallowed config key(s): ${unknownKeys.join(', ')}. Allowed key: allow`,
    );
  }
  const rawAllow = config['allow'];
  if (!Array.isArray(rawAllow) || rawAllow.length === 0 || rawAllow.some((a) => typeof a !== 'string')) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "api:call" requires a non-empty "allow" list of endpoint names, ` +
        `or ["*"] for any endpoint the project declares`,
    );
  }
  // `'*'` is the ONE wildcard: "any endpoint THIS project declares". It exists for agents that
  // cannot know the endpoint names up front because they are authored per project at runtime —
  // the user's own orchestrator (THING) inside the user's own project. It stays an explicit,
  // opt-in declaration: the list is still required, and a named list still means ONLY those.
  // The list is enforced where `apiCall` is resolved (eval/yield-router.ts).
  return { allow: rawAllow as string[] };
}

/** Parse + validate a `connections:use` config payload into `{ providers: string[] }`. */
function parseConnectionsConfig(config: unknown, ctx: ParseCapabilitiesCtx): { providers: string[] } {
  if (!isRecord(config)) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "connections:use" has an invalid config: expected a map like { providers: [...] }`,
    );
  }
  const unknownKeys = Object.keys(config).filter((k) => k !== 'providers');
  if (unknownKeys.length > 0) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "connections:use" has disallowed config key(s): ${unknownKeys.join(', ')}. Allowed key: providers`,
    );
  }
  const rawProviders = config['providers'];
  if (!Array.isArray(rawProviders) || rawProviders.length === 0 || rawProviders.some((p) => typeof p !== 'string')) {
    throw new Error(
      `Agent "${ctx.agentId}" capability "connections:use" requires a non-empty "providers" list of service ids (there is no "connect to anything")`,
    );
  }
  return { providers: rawProviders as string[] };
}

/**
 * Parse the frontmatter `capabilities:` list into an {@link AppCapabilities}
 * model. `raw` is the raw frontmatter value (expected: a list); `undefined`/
 * absent yields an empty model. Throws (fail-loud) on any malformed entry.
 */
export function parseCapabilities(raw: unknown, ctx: ParseCapabilitiesCtx): AppCapabilities {
  const result: AppCapabilities = {};
  if (raw === undefined || raw === null) return result;

  if (!Array.isArray(raw)) {
    throw new Error(
      `Agent "${ctx.agentId}" "capabilities" must be a list of capability ids (bare) or single-key maps (id: { config })`,
    );
  }

  for (const entry of raw) {
    let id: string;
    let config: unknown; // undefined = bare entry

    if (typeof entry === 'string') {
      id = entry;
    } else if (isRecord(entry)) {
      const keys = Object.keys(entry);
      if (keys.length !== 1) {
        throw new Error(
          `Agent "${ctx.agentId}" capability entry must be a single-key map (id: { config }); got keys: ${keys.join(', ') || '(none)'}`,
        );
      }
      id = keys[0]!;
      config = entry[id];
    } else {
      throw new Error(
        `Agent "${ctx.agentId}" has an invalid capabilities entry: expected a string id or a single-key map, got ${typeof entry}`,
      );
    }

    if (!CAPABILITY_IDS.has(id as CapabilityId)) {
      throw new Error(
        `Agent "${ctx.agentId}" declares unknown capability "${id}". Known capabilities: ${[...CAPABILITY_IDS].join(', ')}`,
      );
    }
    const capId = id as CapabilityId;

    if (result[capId] !== undefined) {
      throw new Error(`Agent "${ctx.agentId}" declares capability "${capId}" more than once`);
    }

    if (BARE_ONLY_CAPABILITY_IDS.has(capId)) {
      if (config !== undefined) {
        throw new Error(
          `Agent "${ctx.agentId}" capability "${capId}" takes no config (bare only) — remove the "{ ... }"`,
        );
      }
      (result as Record<string, unknown>)[capId] = true;
      continue;
    }

    if (DB_CAPABILITY_IDS.has(capId)) {
      // Bare db cap = all tables; config narrows to named tables.
      (result as Record<string, unknown>)[capId] =
        config === undefined ? {} : parseDbConfig(capId, config, ctx);
      continue;
    }

    // knowledge:write — bare = own space only; optional config narrows/extends via `spaces`.
    if (capId === 'knowledge:write') {
      result['knowledge:write'] = config === undefined ? {} : parseKnowledgeWriteConfig(config, ctx);
      continue;
    }

    // connections:use — providers list is REQUIRED, so a bare entry is an error.
    if (capId === 'connections:use') {
      if (config === undefined) {
        throw new Error(
          `Agent "${ctx.agentId}" capability "connections:use" requires a config with a "providers" list, e.g. connections:use: { providers: [google] }`,
        );
      }
      result['connections:use'] = parseConnectionsConfig(config, ctx);
      continue;
    }

    // api:call — allow list is REQUIRED, so a bare entry is an error.
    if (config === undefined) {
      throw new Error(
        `Agent "${ctx.agentId}" capability "api:call" requires a config with an "allow" list, e.g. api:call: { allow: [markRead] }`,
      );
    }
    result['api:call'] = parseApiCallConfig(config, ctx);
  }

  // Team grants are POD-conditional, and this is the only place that can honour
  // "not granted ⇒ not injected AND absent from the DTS" for them: both the
  // injector and the ambient-DTS builder read this parsed model, so dropping the
  // grant here removes the globals AND their declarations in one move.
  //
  // Dropped, never rejected. THING's `instruct.md` is one file shipped to both
  // kinds of pod — throwing on a personal pod would make the system space fail to
  // load everywhere, which is the opposite of inert. Validation still ran above
  // (an unknown id, or a config on a bare-only team cap, throws on EVERY pod), so
  // a malformed declaration cannot hide on a personal pod and surface in prod.
  if (!isTeamPod()) {
    for (const id of TEAM_CAPABILITY_IDS) delete result[id];
  } else {
    // The mirror image, and dropped rather than rejected for the same reason: one `instruct.md`
    // ships to both kinds of pod, so throwing here would make the space fail to load on a team
    // pod entirely. See DESKTOP_ONLY_CAPABILITY_IDS.
    for (const id of DESKTOP_ONLY_CAPABILITY_IDS) delete result[id];
  }

  return result;
}
