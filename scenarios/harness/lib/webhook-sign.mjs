/**
 * webhook-sign.mjs — compute a provider's HMAC signature header, matching the declarative `hmac`
 * VerifySpec shape every `WebhookEmitterDef.verify` in the product uses
 * (`{type:'hmac', algo, encoding, header, prefix}` — see e.g.
 * store/spaces/integration-demo/events/messages.ts's `verify` block). The scenario harness needs
 * this because a webhook's shared secret is only known at RUN time (set via the `set_env` step
 * verb, or already present in the pod's env) — a static `scenario.yaml` can declare the payload but
 * can never precompute a valid signature over it, so the `inbound` step verb signs it here, right
 * before delivery, using whatever secret the pod's env currently holds (see `env.mjs#readEnvVar`).
 *
 * Generic across every HMAC-verified provider this scheme covers, not just `demo` — a scenario step
 * names its OWN header/algo/encoding/prefix/secretEnv, matching its own emitter def's `verify`.
 */
import { createHmac } from 'node:crypto';

/**
 * @param {string} secret   the raw shared secret (read from the pod's current env)
 * @param {string} rawBody  the EXACT bytes that will be POSTed (sign the already-serialized body)
 * @param {{ algo?: string, encoding?: 'hex'|'base64', prefix?: string }} [spec]
 * @returns {string} the header VALUE, e.g. `sha256=<hex>`
 */
export function signHmac(secret, rawBody, { algo = 'sha256', encoding = 'hex', prefix = '' } = {}) {
  return prefix + createHmac(algo, secret ?? '').update(rawBody, 'utf8').digest(encoding);
}
