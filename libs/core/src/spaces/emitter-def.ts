/**
 * Emitter definitions — the PRODUCER side of the unified event pipeline,
 * symmetric with hooks (the consumer side). An `events/` dir in a SPACE or a
 * PROJECT holds named `.ts` files, each default-exporting one {@link EmitterDef}:
 * a typed contract for the events that scope produces.
 *
 * There are four producer kinds (discriminated on `type`):
 *   - `webhook`   — an external caller `POST`s to the def's own `path`; a pure
 *                   `emit(inbound)` turns the verified request into events.
 *   - `cron`      — a scheduled poll; `emit(ctx)` runs with a gated ctx.
 *   - `db`        — a project-db write to `on.table`/`on.event`; `emit(row)`.
 *   - `internal`  — an lmthing runtime signal (`on.signal`); `emit(signal)`.
 *
 * The payload schema of every event a def produces is declared INLINE in
 * `emits` (event name → field → typeString), using the SAME typeString
 * vocabulary as a tasklist node's `output` (`tasklist/schema.ts`). Emitted
 * payloads are validated against this schema at dispatch time (drop-with-warn).
 *
 * This module holds ONLY the types (core stays dependency-free). Pure
 * validation lives in `emitter-load.ts`; the fs scan + worker-isolated
 * extraction lives cli-side (`server/emitter-manifests.ts`).
 */
import type { ChallengeSpec, VerifySpec } from './verify-spec.js';

/**
 * A single event a def produces, at dispatch time. `event` is the event name
 * (must be one of the def's declared `emits` keys); `payload` is validated
 * against `emits[event].payload`; `threadKey` (optional) derives a stable
 * conversation thread for multi-turn continuity (omit ⇒ one-shot run).
 */
export interface Emitted {
  event: string;
  payload: Record<string, unknown>;
  threadKey?: string;
}

/**
 * Inline payload schemas: event name → `{ payload }`, where `payload` maps a
 * field name to a typeString (`'string'|'number'|'boolean'|'object'|'array'|
 * 'any'`) — the tasklist-`output` vocabulary (`tasklist/schema.ts`).
 */
export type EmitsSchema = Record<string, { payload: Record<string, string> }>;

/** The verified inbound request handed to a webhook emitter's `emit`. */
export interface WebhookInbound {
  /** Parsed JSON body (or `undefined`/`null` when the body isn't JSON). */
  json: unknown;
  /** The raw request body string. */
  raw: string;
  /** Lower-cased request headers. */
  headers: Record<string, string>;
  /** The public path segment this def is bound to. */
  path: string;
}

/**
 * How a webhook emitter authenticates its inbound: either a declarative
 * {@link VerifySpec} the generic engine interprets, or the `builtin` shorthand
 * for a provider whose scheme isn't expressible in the generic union (Slack's
 * skew guard + `url_verification` preflight; GitHub's signature) — resolved
 * pod-side by `webhook-verifiers.ts`.
 */
export type WebhookVerify = VerifySpec | { type: 'builtin'; provider: 'slack' | 'github' };

/**
 * A webhook producer: an external caller `POST`s to `path` (its OWN inbound
 * URL, independent of legacy `triggers:` bindings). After the host verifies the
 * request (+ optional preflight/challenge/dedupe), the PURE `emit(inbound)`
 * turns it into events. `emit` runs worker-isolated at dispatch (never in the
 * verify path); no side effects, no i/o.
 */
export interface WebhookEmitterDef {
  type: 'webhook';
  /** URL-safe path segment, globally unique per pod (the routing key). */
  path: string;
  /** How to authenticate the inbound request. */
  verify: WebhookVerify;
  /** Pod env var holding the signing secret / public key / auth token. */
  secretEnv?: string;
  /** Optional GET subscription-verification echo (WhatsApp / Meta). */
  challenge?: ChallengeSpec;
  /** Declared event → payload schema. */
  emits: EmitsSchema;
  /** Pure: verified request → events. */
  emit(inbound: WebhookInbound): Emitted[];
}

/**
 * The gated ctx handed to a cron emitter's `emit`. Provided by the host at run
 * time (core stays pod-dep-free — the shape is intentionally loose). `state` is
 * a non-executable JSON KV scratchpad persisted per def; `callConnection`
 * reaches a declared/own provider (SSRF-pinned); `env` exposes declared secrets.
 */
export interface CronEmitterCtx {
  state?: Record<string, unknown>;
  callConnection?: (provider: string, req: unknown) => Promise<unknown>;
  env?: Record<string, string | undefined>;
}

/**
 * A polling producer: the host runs `emit(ctx)` on the def's schedule (exactly
 * one of `every`/`daily`). `connections` declares the providers `ctx.callConnection`
 * may reach (project scope; space defs are locked to their own provider).
 */
export interface CronEmitterDef {
  type: 'cron';
  /** Interval schedule (`<n>m|h|d`), mutually exclusive with `daily`. */
  every?: string;
  /** Daily wall-clock schedule (`HH:MM`), mutually exclusive with `every`. */
  daily?: string;
  /** Declared outbound providers this def may `callConnection` (project scope). */
  connections?: string[];
  /** Declared event → payload schema. */
  emits: EmitsSchema;
  /** Async: poll a provider (via `ctx`) → events. */
  emit(ctx: CronEmitterCtx): Promise<Emitted[]>;
}

/** The three project-db write events a db emitter may subscribe to (matches
 *  the cli hook loader's `WriteEventKind`). */
export type DbEmitterEvent = 'insert' | 'update' | 'remove';

/** The written row handed to a db emitter's `emit`. */
export interface DbEmitterRow {
  table: string;
  event: DbEmitterEvent;
  row: Record<string, unknown>;
}

/**
 * A db-write producer: fires when `on.table`/`on.event` is written to the
 * project db. The PURE `emit(row)` turns the written row into events.
 */
export interface DbEmitterDef {
  type: 'db';
  on: { table: string; event: DbEmitterEvent };
  /** Declared event → payload schema. */
  emits: EmitsSchema;
  /** Pure: written row → events. */
  emit(row: DbEmitterRow): Emitted[];
}

/** An lmthing runtime signal handed to an internal emitter's `emit`. */
export interface InternalSignal {
  name: string;
  data: Record<string, unknown>;
}

/**
 * An internal-signal producer: fires on an lmthing runtime signal (session /
 * agent lifecycle, space installs, hook fires, document writes, project
 * changes) matched by `on.signal`. The PURE `emit(signal)` normalizes it.
 */
export interface InternalEmitterDef {
  type: 'internal';
  on: { signal: string };
  /** Declared event → payload schema. */
  emits: EmitsSchema;
  /** Pure: runtime signal → events. */
  emit(signal: InternalSignal): Emitted[];
}

/** The default export of an `events/<name>.ts` file. */
export type EmitterDef = WebhookEmitterDef | CronEmitterDef | DbEmitterDef | InternalEmitterDef;

/** A discovered, validated emitter def (filename basename → def). */
export interface LoadedEmitter {
  /** The filename basename (`slack-inbound`) — stable id, unique per scope. */
  name: string;
  def: EmitterDef;
}
