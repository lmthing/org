/**
 * Declarative inbound-webhook verify specs — the SINGLE source of truth.
 *
 * These shapes describe HOW the pod authenticates an inbound request, purely as
 * data (never code) so a store-downloaded space (a `package.json`
 * `lmthing.webhook` descriptor, or an `events/*.ts` webhook emitter def) can't
 * inject executable verifier logic into the pod: every field is a string / enum
 * the generic engine (`libs/cli/src/server/webhook-verifiers.ts`
 * `buildAdapterFromDescriptor`) interprets. All crypto (HMAC / Ed25519 /
 * constant-time compare) runs pod-side against these specs.
 *
 * Lifted from `libs/cli/src/server/webhook-descriptor.ts` into `@lmthing/core`
 * so both the legacy descriptor (`webhook-descriptor.ts`) and the new emitter
 * defs (`emitter-def.ts`) share one union + one validator (`isValidVerifySpec`).
 * The cli module re-exports these types for back-compat.
 */

/**
 * One piece of the byte string a signature is computed over, concatenated in
 * order. `'body'` = the raw request body; `{header}` = a request header value
 * (empty string if absent); `{literal}` = a fixed string (e.g. Slack's `v0:`).
 * Defaults to `['body']` when a spec omits `signed`.
 */
export type SignedPart = 'body' | { header: string } | { literal: string };

/**
 * How to authenticate an inbound request. The resolved secret (from the
 * owning descriptor/def's `secretEnv`) is passed to the engine as key material
 * — the signing secret for `hmac`/`header-equals`/`body-token`, the app public
 * key (hex) for `ed25519`, the auth token for `twilio`.
 */
export type VerifySpec =
  /** No verification (unauthenticated ingress — same posture as `generic`). */
  | { type: 'none' }
  /** Constant-time compare a header value against the secret (Telegram's
   *  `x-telegram-bot-api-secret-token`). */
  | { type: 'header-equals'; header: string }
  /** Constant-time compare a body field against the secret (Mattermost /
   *  Synology outgoing-webhook shared `token`). `bodyType` picks the decoder. */
  | { type: 'body-token'; field: string; bodyType?: 'form' | 'json' | 'auto' }
  /** HMAC over `signed` (default `['body']`), compared to `header` after an
   *  optional `prefix` (GitHub/WhatsApp `sha256=`, Slack `v0=`). `skewHeader`+
   *  `maxSkewSeconds` add a replay window (Slack). */
  | {
      type: 'hmac';
      algo: 'sha1' | 'sha256';
      encoding: 'hex' | 'base64';
      header: string;
      prefix?: string;
      signed?: SignedPart[];
      skewHeader?: string;
      maxSkewSeconds?: number;
    }
  /** Ed25519 over `signed` (default `[{header:tsHeader},'body']` when `tsHeader`
   *  is set, else `['body']`); the secret is the app's hex public key (Discord). */
  | { type: 'ed25519'; sigHeader: string; tsHeader?: string; signed?: SignedPart[] }
  /** Twilio's bespoke scheme: base64 HMAC-SHA1 over the forwarded public URL
   *  (`x-lmthing-inbound-url`) + form params sorted by key, concatenated. */
  | { type: 'twilio' };

/**
 * A synchronous setup handshake answered BEFORE any agent wakes. `json-echo`
 * matches a JSON body field and returns either a fixed `respond` object
 * (Discord PING → `{type:1}`) or echoes a field back (`respondEcho`).
 */
export interface PreflightSpec {
  type: 'json-echo';
  when: { field: string; equals: unknown };
  respond?: unknown;
  respondEcho?: { field: string };
}

/**
 * A GET subscription-verification echo (WhatsApp / Meta): on `GET`, if the
 * `tokenParam` query value equals `process.env[verifyTokenEnv]`, echo the
 * `challengeParam` query value back as plain text. Params default to Meta's
 * `hub.mode` / `hub.verify_token` / `hub.challenge`.
 */
export interface ChallengeSpec {
  type: 'hub-challenge';
  verifyTokenEnv: string;
  modeParam?: string;
  tokenParam?: string;
  challengeParam?: string;
}

/**
 * How to derive a stable conversation thread key (for multi-turn continuity).
 * Omit ⇒ every event is a one-shot run. The key is `<prefix>:<value>`.
 */
export type ThreadSpec =
  | { from: 'body'; path: string; prefix?: string }
  | { from: 'form'; field: string; prefix?: string }
  | { from: 'header'; header: string; prefix?: string };

/** Known verify-spec types + the allowed hmac params. A spec carrying an
 *  unknown type / weak-or-bogus hmac config is rejected outright (fail-closed)
 *  rather than reaching the crypto engine as an unvalidated `unknown`. */
const VERIFY_TYPES = new Set(['none', 'header-equals', 'body-token', 'hmac', 'ed25519', 'twilio']);
const HMAC_ALGOS = new Set(['sha1', 'sha256']);
const HMAC_ENCODINGS = new Set(['hex', 'base64']);

/**
 * Validate a raw verify spec (data-only) against the {@link VerifySpec} union.
 * Returns true when the engine can safely interpret it. Fail-closed on any
 * unknown type or a malformed `hmac`/`header-equals`/`body-token`/`ed25519`.
 */
export function isValidVerifySpec(verify: Record<string, unknown>): boolean {
  const type = verify['type'];
  if (typeof type !== 'string' || !VERIFY_TYPES.has(type)) return false;
  if (type === 'hmac') {
    if (!HMAC_ALGOS.has(String(verify['algo']))) return false;
    if (!HMAC_ENCODINGS.has(String(verify['encoding']))) return false;
    if (typeof verify['header'] !== 'string' || !verify['header']) return false;
  }
  if (type === 'header-equals' && (typeof verify['header'] !== 'string' || !verify['header'])) return false;
  if (type === 'body-token' && (typeof verify['field'] !== 'string' || !verify['field'])) return false;
  if (type === 'ed25519' && (typeof verify['sigHeader'] !== 'string' || !verify['sigHeader'])) return false;
  return true;
}
