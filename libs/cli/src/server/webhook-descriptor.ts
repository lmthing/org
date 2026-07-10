/**
 * Declarative descriptor for an integration space's INBOUND webhook.
 *
 * This is the "contained" replacement for per-provider adapter code: an
 * integration space carries this object in its `package.json` `lmthing.webhook`
 * block, and the pod's generic verifier engine (`webhook-verifiers.ts`
 * `buildAdapterFromDescriptor`) turns it into a {@link WebhookAdapter} at
 * dispatch time. Adding a new messaging platform therefore needs NO pod code —
 * only a new space folder carrying its own `connection` + `webhook` descriptors.
 *
 * The shapes here are intentionally DECLARATIVE (data, never code) so a store
 * space can't inject executable logic into the pod: every field is a string /
 * enum the generic engine interprets. All crypto (HMAC/Ed25519/constant compare)
 * runs pod-side against these specs; the space never ships a verifier.
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
 * descriptor's `secretEnv`, see {@link WebhookDescriptor}) is passed to the
 * engine as key material — the signing secret for `hmac`/`header-equals`/
 * `body-token`, the app public key (hex) for `ed25519`, the auth token for
 * `twilio`.
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

/** The `lmthing.webhook` block an integration space carries in its package.json. */
export interface WebhookDescriptor {
  /** The provider id — matches the handler agent's `triggers:[{webhook:{provider}}]`. */
  provider: string;
  /** Pod env var holding the signing secret / public key / auth token. */
  secretEnv?: string;
  /** How to authenticate the request. */
  verify: VerifySpec;
  /** Optional thread-key derivation (omit ⇒ one-shot). */
  thread?: ThreadSpec;
  /** Optional pre-agent handshake (Discord PING). */
  preflight?: PreflightSpec;
  /** Optional GET subscription-verification echo (WhatsApp). */
  challenge?: ChallengeSpec;
}
