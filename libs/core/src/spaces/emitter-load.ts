/**
 * Pure validation for emitter defs (`emitter-def.ts`) — no fs, no worker. The
 * fs scan + worker-isolated extraction that *calls* this lives cli-side
 * (`server/emitter-manifests.ts`); this module is the shared, dependency-free
 * validator so both the pod scanner and the store's catalog-gen script enforce
 * ONE contract.
 *
 * `validateEmitterDef` fail-loud validates a raw default export into a typed
 * {@link EmitterDef} (mirrors `validateHook` in `libs/cli/src/app/hooks/loader.ts`):
 * the discriminated `type`, the verify union (incl. the `builtin` shorthand),
 * cron schedules, webhook path, and every event's inline payload typeStrings.
 */
import { isValidVerifySpec } from './verify-spec.js';
import type {
  CronEmitterDef,
  DbEmitterDef,
  EmitsSchema,
  EmitterDef,
  InternalEmitterDef,
  LoadedEmitter,
  WebhookEmitterDef,
} from './emitter-def.js';

// Schedule + path patterns MIRROR the cli hook loader (`app/hooks/loader.ts`)
// and core space loader (`spaces/load.ts`) — one vocabulary across producers and
// consumers. Kept as local copies (not a cross-package import) so core stays
// self-contained; keep them in lockstep if the loader's ever change.
const DAILY_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EVERY_RE = /^\d+[mhd]$/;
const WEBHOOK_PATH_RE = /^[A-Za-z0-9_-]+$/;

/** Event names are dot-separated lowercase segments (`message.posted`,
 *  `db.raw_items.insert`) — the addressing key subscribers match on. */
const EVENT_NAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)*$/;

/** Payload field typeStrings — the SAME vocabulary as a tasklist node's
 *  `output` (`tasklist/schema.ts`). Validated strictly here (an emitter's
 *  contract must be sound), unlike the lenient runtime `validateOutput`. */
const TYPESTRINGS = new Set(['string', 'number', 'boolean', 'object', 'array', 'any']);

/** Validate an `emits` block: event names + inline payload typeStrings. */
function validateEmits(where: string, raw: unknown): EmitsSchema {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where}: \`emits\` must be an object mapping event name → { payload }`);
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error(`${where}: \`emits\` must declare at least one event`);
  }
  const emits: EmitsSchema = {};
  for (const [event, spec] of entries) {
    if (!EVENT_NAME_RE.test(event)) {
      throw new Error(
        `${where}: invalid event name "${event}" (expected dot-separated lowercase segments, e.g. 'message.posted')`,
      );
    }
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error(`${where}: event "${event}" must be an object \`{ payload }\``);
    }
    const payload = (spec as Record<string, unknown>)['payload'];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`${where}: event "${event}" needs a \`payload\` object (field → typeString)`);
    }
    const fields: Record<string, string> = {};
    for (const [field, type] of Object.entries(payload as Record<string, unknown>)) {
      // A trailing `?` marks the field optional (`'string?'`); the base type must
      // still be a known typeString. The `?` is preserved in the stored schema so
      // the DTS generator emits an optional member and runtime validation tolerates
      // its absence.
      const base = typeof type === 'string' && type.endsWith('?') ? type.slice(0, -1) : type;
      if (typeof type !== 'string' || typeof base !== 'string' || !TYPESTRINGS.has(base)) {
        throw new Error(
          `${where}: event "${event}" field "${field}" has an invalid typeString ${JSON.stringify(type)} ` +
            `(expected ${[...TYPESTRINGS].join(' | ')}, optionally suffixed with '?')`,
        );
      }
      fields[field] = type;
    }
    emits[event] = { payload: fields };
  }
  return emits;
}

/** Validate the webhook emitter's `verify` (declarative union OR the `builtin`
 *  shorthand for slack/github, whose schemes aren't expressible in the union). */
function validateWebhookVerify(where: string, raw: unknown): WebhookEmitterDef['verify'] {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${where}: a webhook emitter needs a \`verify\` spec`);
  }
  const v = raw as Record<string, unknown>;
  if (v['type'] === 'builtin') {
    if (v['provider'] !== 'slack' && v['provider'] !== 'github') {
      throw new Error(`${where}: \`verify: { type: 'builtin' }\` needs provider 'slack' | 'github'`);
    }
    return { type: 'builtin', provider: v['provider'] };
  }
  if (!isValidVerifySpec(v)) {
    throw new Error(`${where}: invalid \`verify\` spec ${JSON.stringify(v['type'])}`);
  }
  return raw as WebhookEmitterDef['verify'];
}

/**
 * Validate a raw default export into a typed {@link EmitterDef} (fail-loud).
 * Pure: never touches fs or runs `emit`. `where` prefixes every error (pass the
 * source filename). `emit` must be a function on every kind.
 */
export function validateEmitterDef(raw: unknown, where: string): EmitterDef {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${where}: default export must be an emitter def object`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj['emit'] !== 'function') {
    throw new Error(`${where}: an emitter def needs an \`emit\` function`);
  }
  const emits = validateEmits(where, obj['emits']);

  if (obj['type'] === 'webhook') {
    if (typeof obj['path'] !== 'string' || obj['path'].length === 0) {
      throw new Error(`${where}: a webhook emitter needs a non-empty \`path\``);
    }
    if (!WEBHOOK_PATH_RE.test(obj['path'])) {
      throw new Error(`${where}: invalid \`path\` "${obj['path']}" (expected URL-safe: letters, digits, '_', '-')`);
    }
    const def: WebhookEmitterDef = {
      type: 'webhook',
      path: obj['path'],
      verify: validateWebhookVerify(where, obj['verify']),
      ...(typeof obj['secretEnv'] === 'string' ? { secretEnv: obj['secretEnv'] } : {}),
      ...(obj['challenge'] !== undefined
        ? { challenge: obj['challenge'] as WebhookEmitterDef['challenge'] }
        : {}),
      emits,
      emit: obj['emit'] as WebhookEmitterDef['emit'],
    };
    return def;
  }

  if (obj['type'] === 'cron') {
    const hasEvery = typeof obj['every'] === 'string';
    const hasDaily = typeof obj['daily'] === 'string';
    if (hasEvery === hasDaily) {
      throw new Error(`${where}: a cron emitter needs exactly one of \`every\` or \`daily\``);
    }
    if (hasEvery && !EVERY_RE.test(obj['every'] as string)) {
      throw new Error(`${where}: invalid \`every\` "${String(obj['every'])}" (expected e.g. '30m'|'2h'|'1d')`);
    }
    if (hasDaily && !DAILY_RE.test(obj['daily'] as string)) {
      throw new Error(`${where}: invalid \`daily\` "${String(obj['daily'])}" (expected 'HH:MM')`);
    }
    if (obj['connections'] !== undefined) {
      if (!Array.isArray(obj['connections']) || obj['connections'].some((c) => typeof c !== 'string')) {
        throw new Error(`${where}: \`connections\` must be an array of provider ids`);
      }
    }
    const def: CronEmitterDef = {
      type: 'cron',
      ...(hasEvery ? { every: obj['every'] as string } : {}),
      ...(hasDaily ? { daily: obj['daily'] as string } : {}),
      ...(Array.isArray(obj['connections']) ? { connections: (obj['connections'] as string[]).slice() } : {}),
      emits,
      emit: obj['emit'] as CronEmitterDef['emit'],
    };
    return def;
  }

  if (obj['type'] === 'db') {
    const on = obj['on'] as Record<string, unknown> | undefined;
    if (!on || typeof on['table'] !== 'string' || !on['table']) {
      throw new Error(`${where}: a db emitter needs \`on: { table, event }\``);
    }
    if (on['event'] !== 'insert' && on['event'] !== 'update' && on['event'] !== 'remove') {
      throw new Error(`${where}: \`on.event\` must be 'insert' | 'update' | 'remove'`);
    }
    const def: DbEmitterDef = {
      type: 'db',
      on: { table: on['table'], event: on['event'] },
      emits,
      emit: obj['emit'] as DbEmitterDef['emit'],
    };
    return def;
  }

  if (obj['type'] === 'internal') {
    const on = obj['on'] as Record<string, unknown> | undefined;
    if (!on || typeof on['signal'] !== 'string' || !on['signal']) {
      throw new Error(`${where}: an internal emitter needs \`on: { signal }\``);
    }
    const def: InternalEmitterDef = {
      type: 'internal',
      on: { signal: on['signal'] },
      emits,
      emit: obj['emit'] as InternalEmitterDef['emit'],
    };
    return def;
  }

  throw new Error(
    `${where}: \`type\` must be 'webhook' | 'cron' | 'db' | 'internal' (got ${JSON.stringify(obj['type'])})`,
  );
}

/**
 * Merge the `emits` of every def in ONE scope (a space's or project's
 * `events/` dir) into a single event → payload map, throwing fail-loud on a
 * duplicate event name declared by two defs. The returned union is the scope's
 * declared-event contract — feed it to {@link buildEventPayloadsDts}.
 */
export function collectDeclaredEvents(defs: LoadedEmitter[]): EmitsSchema {
  const union: EmitsSchema = {};
  const owner = new Map<string, string>();
  for (const { name, def } of defs) {
    for (const [event, spec] of Object.entries(def.emits)) {
      const prior = owner.get(event);
      if (prior !== undefined) {
        throw new Error(
          `[emitter-load] duplicate event "${event}" declared by both "${prior}" and "${name}" — event names must be unique within a scope`,
        );
      }
      owner.set(event, name);
      union[event] = spec;
    }
  }
  return union;
}

/** Map a payload typeString to its TS type for the generated DTS. A trailing `?`
 *  (optional marker) is stripped here; optionality is applied to the MEMBER
 *  (`"field"?: T`) by the caller. */
function tsType(typeString: string): string {
  const base = typeString.endsWith('?') ? typeString.slice(0, -1) : typeString;
  switch (base) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'Record<string, unknown>';
    case 'array':
      return 'unknown[]';
    default: // 'any' + any lenient leftover
      return 'unknown';
  }
}

/**
 * Build a DTS fragment declaring the `EventPayloads` map from a scope's emits
 * union (`collectDeclaredEvents`): event name → payload object type. Consumers
 * (event hooks, `emitEvent`) typecheck their payloads against this. Keys are
 * sorted for deterministic output. An empty union yields
 * `interface EventPayloads {}`.
 */
export function buildEventPayloadsDts(emitsUnion: EmitsSchema): string {
  const events = Object.keys(emitsUnion).sort();
  const lines: string[] = ['declare interface EventPayloads {'];
  for (const event of events) {
    const fields = emitsUnion[event]!.payload;
    const members = Object.keys(fields)
      .sort()
      .map((f) => {
        const opt = fields[f]!.endsWith('?') ? '?' : '';
        return `${JSON.stringify(f)}${opt}: ${tsType(fields[f]!)}`;
      })
      .join('; ');
    lines.push(`  ${JSON.stringify(event)}: { ${members} };`);
  }
  lines.push('}');
  return lines.join('\n');
}
