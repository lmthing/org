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

// The declarative verify/preflight/challenge/thread SPEC TYPES now live in
// `@lmthing/core` (`spaces/verify-spec.ts`) so the legacy descriptor here and
// the new `events/*.ts` emitter defs share ONE union + ONE validator
// (`isValidVerifySpec`). Re-exported here for back-compat with existing importers.
export type { SignedPart, VerifySpec, PreflightSpec, ChallengeSpec, ThreadSpec } from '@lmthing/core';
import type { VerifySpec, PreflightSpec, ChallengeSpec, ThreadSpec } from '@lmthing/core';

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
  /** Explicit opt-in for an UNAUTHENTICATED inbound (`verify:{type:'none'}`).
   *  Without this flag a `none` verifier fails CLOSED (rejects every request) so
   *  a space can't accidentally — or sneakily — expose an unsigned webhook that
   *  wakes the pod + runs an agent for any anonymous caller. */
  allowUnauthenticated?: boolean;
}
