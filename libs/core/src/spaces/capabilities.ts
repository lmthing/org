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
  | 'api:write'
  | 'hooks:write'
  | 'api:call';

/** Every recognized capability id. Unknown ids fail the space load. */
export const CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'db:read',
  'db:write',
  'db:schema',
  'pages:write',
  'api:write',
  'hooks:write',
  'api:call',
]);

/** The three db verbs whose (optional) config narrows scope to `{ tables: [...] }`. */
export const DB_CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'db:read',
  'db:write',
  'db:schema',
]);

/** Authoring caps that are **bare-only** — a config payload is an error. */
const BARE_ONLY_CAPABILITY_IDS: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'pages:write',
  'api:write',
  'hooks:write',
]);

/**
 * The parsed capability model attached to a loaded agent. A present key means
 * the cap is GRANTED; its value carries the (optional) scope narrowing:
 *   - `db:*`      → `{ tables?: string[] }` (omitted `tables` = all tables)
 *   - `api:call`  → `{ allow: string[] }` (always present — required)
 *   - authoring   → `true` (bare, no config)
 */
export interface AppCapabilities {
  'db:read'?: { tables?: string[] };
  'db:write'?: { tables?: string[] };
  'db:schema'?: { tables?: string[] };
  'pages:write'?: true;
  'api:write'?: true;
  'hooks:write'?: true;
  'api:call'?: { allow: string[] };
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
      `Agent "${ctx.agentId}" capability "api:call" requires a non-empty "allow" list of endpoint names (there is no "call anything")`,
    );
  }
  return { allow: rawAllow as string[] };
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

    // api:call — allow list is REQUIRED, so a bare entry is an error.
    if (config === undefined) {
      throw new Error(
        `Agent "${ctx.agentId}" capability "api:call" requires a config with an "allow" list, e.g. api:call: { allow: [markRead] }`,
      );
    }
    result['api:call'] = parseApiCallConfig(config, ctx);
  }

  return result;
}
