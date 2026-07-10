/**
 * Shared {@link WebhookAdapter} contract + crypto primitives for inbound webhook
 * verification. Lives in its own module so `webhook-verifiers.ts` (built-in
 * adapters + the descriptor-driven generic engine) can import them without a
 * circular dependency.
 *
 * Every adapter method is DEFENSIVE: a malformed body/header must never throw out
 * of `verify`/`extractThread`/`renderMessage`/`preflight` — worst case `verify`
 * returns `false` (safe default: reject).
 */
import { createHmac, timingSafeEqual, verify as cryptoVerify, createPublicKey } from 'node:crypto';

export interface WebhookAdapter {
  /** Verify the request authenticity. `secret` is the per-binding/provider signing
   *  secret (may be undefined). Return true when authentic. Never throw — return
   *  false on any parse/HMAC error. */
  verify(rawBody: string, headers: Record<string, string>, secret: string | undefined): boolean;
  /** A stable thread key for conversation continuity, or null for one-shot. */
  extractThread(rawBody: string, headers: Record<string, string>): string | null;
  /** Render the request into the agent's user message (plain text). */
  renderMessage(path: string, rawBody: string, headers: Record<string, string>): string;
  /** Optional synchronous pre-response (e.g. Slack url_verification, Discord PING).
   *  Return { status, body } to short-circuit BEFORE waking any agent, or null. */
  preflight?(rawBody: string, headers: Record<string, string>): { status: number; body: unknown } | null;
  /** When true, a missing/invalid secret means reject (401). */
  requiresSecret: boolean;
}

/** Constant-time compare. `timingSafeEqual` throws on a length mismatch, so guard
 *  that first — a length mismatch is itself just "not equal", not an error. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Parse `rawBody` as a JSON object, returning `undefined` (never throwing) on a
 *  non-JSON or non-object body. */
export function tryParseJson(rawBody: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* non-JSON body */
  }
  return undefined;
}

/** Decode an `application/x-www-form-urlencoded` body into a flat string map
 *  (first value per key). Never throws. */
export function formDecode(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [k, v] of new URLSearchParams(rawBody)) {
      if (!(k in out)) out[k] = v;
    }
  } catch {
    /* malformed — return what we have */
  }
  return out;
}

/** Hex HMAC-SHA256 of `data` keyed by `secret`. */
export function hmacHexSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

/** Base64 HMAC-SHA256 of `data` keyed by `secret` (LINE `x-line-signature`). */
export function hmacBase64Sha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

/** Base64 HMAC-SHA1 of `data` keyed by `secret` (Twilio `X-Twilio-Signature`). */
export function hmacBase64Sha1(secret: string, data: string): string {
  return createHmac('sha1', secret).update(data, 'utf8').digest('base64');
}

/** The 12-byte ASN.1/DER SPKI prefix for a raw Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify an Ed25519 signature (Discord interactions). `publicKeyHex` is the app's
 * 32-byte hex public key; `message` is `timestamp + rawBody`; `signatureHex` is the
 * hex signature from `X-Signature-Ed25519`. Never throws — returns false on any error.
 */
export function verifyEd25519(publicKeyHex: string, message: string, signatureHex: string): boolean {
  try {
    const raw = Buffer.from(publicKeyHex, 'hex');
    if (raw.length !== 32) return false;
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(null, Buffer.from(message, 'utf8'), keyObject, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}
