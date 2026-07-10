/**
 * Inbound-webhook replay/idempotency guard.
 *
 * Most providers' inbound verifiers have no per-request nonce (Telegram's static
 * secret token, Line/WhatsApp/Nextcloud HMAC-over-body), so a captured *authentic*
 * webhook could be replayed to re-run the handler agent — and providers also
 * legitimately RESEND the identical payload on a timeout/5xx. Both are handled the
 * same, correct way: process a given `(path, rawBody)` at most once per TTL window.
 *
 * The key is a hash of the raw bytes, so it's provider-agnostic (no per-provider id
 * extraction) and never deduplicates *distinct* messages — real events differ in
 * their embedded id/timestamp, so only byte-identical replays/retries collide.
 *
 * In-memory + per-pod (the pod is single-process); pruned lazily. Fail-open: only
 * called AFTER signature verification, so an attacker can't poison the set without a
 * valid signature, and an empty body is never deduped (nothing to key on).
 */
import { createHash } from 'node:crypto';

const TTL_MS = Number(process.env['LMTHING_WEBHOOK_DEDUPE_TTL_MS']) || 10 * 60_000;
const PRUNE_INTERVAL_MS = 60_000;

const seen = new Map<string, number>(); // key → expiry epoch-ms
let lastPrune = 0;

function prune(now: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
}

/** Hash of the inbound path + raw body — the dedupe key. */
export function dedupeKey(path: string, rawBody: string): string {
  return createHash('sha256').update(path).update('\n').update(rawBody).digest('hex');
}

/**
 * True if this exact `(path, rawBody)` was already accepted within the TTL (a
 * replay or a provider retry) — records it and returns false otherwise. Empty
 * bodies are never treated as duplicates.
 */
export function isDuplicateInbound(path: string, rawBody: string): boolean {
  if (!rawBody) return false;
  const now = Date.now();
  prune(now);
  const key = dedupeKey(path, rawBody);
  const exp = seen.get(key);
  if (exp !== undefined && exp > now) return true;
  seen.set(key, now + TTL_MS);
  return false;
}

/** Test seam — drop all remembered keys. */
export function clearInboundDedupe(): void {
  seen.clear();
  lastPrune = 0;
}
