/**
 * Inbound-webhook verification — the generic, self-contained engine.
 *
 * TWO sources of adapter behaviour:
 *   1. Built-in adapters (`generic`, `slack`, `github`) defined inline below —
 *      shipped, live, and left untouched.
 *   2. DESCRIPTOR-DRIVEN adapters built at dispatch time from an integration
 *      space's declarative `lmthing.webhook` block (`buildAdapterFromDescriptor`).
 *      This is what makes messaging integrations SELF-CONTAINED: the space
 *      carries its own `verify`/`thread`/`preflight`/`challenge` spec, and the
 *      pod interprets it with generic crypto primitives — no per-provider code.
 *
 * `routes/webhooks.ts` looks up the owning space's descriptor (via
 * `integration-manifests.ts`) and passes it to {@link getAdapter} /
 * {@link resolveWebhookSecret}; when there's no descriptor it falls back to the
 * built-in map, then `generic`.
 *
 * Every adapter method is defensive: a malformed body/header never throws out of
 * `verify`/`extractThread`/`renderMessage`/`preflight` — worst case `verify`
 * returns `false` (safe default: reject) and the others fall back to embedding
 * the raw body.
 */
import { createHmac } from 'node:crypto';
import type { WebhookEmitterDef } from '@lmthing/core';
import { safeEqual, tryParseJson, formDecode, verifyEd25519, type WebhookAdapter } from './webhook-crypto.js';
import type {
  WebhookDescriptor,
  VerifySpec,
  SignedPart,
  PreflightSpec,
  ThreadSpec,
} from './webhook-descriptor.js';

export type { WebhookAdapter } from './webhook-crypto.js';

// ── built-in: generic ──────────────────────────────────────────────────────

const generic: WebhookAdapter = {
  requiresSecret: false,
  verify(rawBody, headers, secret) {
    if (!secret) return true; // no secret configured ⇒ verification not applicable
    try {
      const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
      const got = headers['x-lmthing-signature'];
      if (!got) return false;
      return safeEqual(got, expected);
    } catch {
      return false;
    }
  },
  extractThread(rawBody, headers) {
    const headerKey = headers['x-lmthing-thread'];
    if (headerKey) return headerKey;
    const body = tryParseJson(rawBody);
    if (body) {
      if (typeof body['threadKey'] === 'string') return body['threadKey'];
      if (typeof body['thread'] === 'string') return body['thread'];
    }
    return null;
  },
  renderMessage(path, rawBody) {
    return `Inbound webhook "${path}" received. Payload (JSON):\n\n${rawBody}\n\nProcess this event.`;
  },
};

// ── built-in: slack ────────────────────────────────────────────────────────

const SLACK_MAX_CLOCK_SKEW_SECONDS = 5 * 60;

const slack: WebhookAdapter = {
  requiresSecret: true,
  verify(rawBody, headers, secret) {
    if (!secret) return false;
    try {
      const timestamp = headers['x-slack-request-timestamp'];
      const signature = headers['x-slack-signature'];
      if (!timestamp || !signature) return false;

      const nowSeconds = Math.floor(Date.now() / 1000);
      const skew = Math.abs(nowSeconds - Number(timestamp));
      if (!Number.isFinite(skew) || skew > SLACK_MAX_CLOCK_SKEW_SECONDS) return false; // replay guard

      const basestring = `v0:${timestamp}:${rawBody}`;
      const expected = 'v0=' + createHmac('sha256', secret).update(basestring, 'utf8').digest('hex');
      return safeEqual(signature, expected);
    } catch {
      return false;
    }
  },
  preflight(rawBody) {
    const body = tryParseJson(rawBody);
    if (body && body['type'] === 'url_verification') {
      return { status: 200, body: { challenge: body['challenge'] } };
    }
    return null;
  },
  extractThread(rawBody) {
    const body = tryParseJson(rawBody);
    const event = body?.['event'] as Record<string, unknown> | undefined;
    if (!event) return null;
    if (typeof event['thread_ts'] === 'string') return event['thread_ts'];
    if (typeof event['ts'] === 'string') return event['ts'];
    if (typeof event['channel'] === 'string') return event['channel'];
    return null;
  },
  renderMessage(path, rawBody) {
    const body = tryParseJson(rawBody);
    const event = body?.['event'] as Record<string, unknown> | undefined;
    const text = event && typeof event['text'] === 'string' ? event['text'] : undefined;

    // Machine-readable reply target so a channel agent can post its answer back
    // to the exact channel/thread via callConnection('slack', ...). `thread_ts`
    // falls back to the message `ts` (replying starts a thread on the message);
    // absent for events with no channel (nothing to reply to). Emitted for both
    // the text and non-text branches so any Slack-triggered agent can rely on it.
    const channel = typeof event?.['channel'] === 'string' ? (event['channel'] as string) : undefined;
    const threadTs =
      typeof event?.['thread_ts'] === 'string'
        ? (event['thread_ts'] as string)
        : typeof event?.['ts'] === 'string'
          ? (event['ts'] as string)
          : undefined;
    const user = typeof event?.['user'] === 'string' ? (event['user'] as string) : undefined;
    const team = typeof body?.['team_id'] === 'string' ? (body['team_id'] as string) : undefined;
    const replyTarget = channel
      ? `\n\n[slack-reply-target] ${JSON.stringify({ channel, thread_ts: threadTs, user, team })}`
      : '';

    if (text === undefined) {
      return `Inbound Slack webhook "${path}" received. Payload (JSON):\n\n${rawBody}${replyTarget}\n\nProcess this event.`;
    }
    const context = [user ? `user ${user}` : null, channel ? `channel ${channel}` : null].filter(Boolean).join(', ');
    return `${context ? `Slack message (${context}):` : 'Slack message:'}\n\n${text}${replyTarget}`;
  },
};

// ── built-in: github ───────────────────────────────────────────────────────

const github: WebhookAdapter = {
  requiresSecret: true,
  verify(rawBody, headers, secret) {
    if (!secret) return false;
    try {
      const got = headers['x-hub-signature-256'];
      if (!got) return false;
      const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
      return safeEqual(got, expected);
    } catch {
      return false;
    }
  },
  extractThread(rawBody) {
    const body = tryParseJson(rawBody);
    if (!body) return null;
    const repo = body['repository'] as Record<string, unknown> | undefined;
    const fullName = typeof repo?.['full_name'] === 'string' ? repo['full_name'] : undefined;
    if (!fullName) return null;
    const issue = body['issue'] as Record<string, unknown> | undefined;
    const pr = body['pull_request'] as Record<string, unknown> | undefined;
    const number = issue?.['number'] ?? pr?.['number'];
    if (typeof number !== 'number') return null;
    return `${fullName}#${number}`;
  },
  renderMessage(path, rawBody, headers) {
    const event = headers['x-github-event'];
    const body = tryParseJson(rawBody);
    if (!body) {
      return `Inbound GitHub webhook "${path}" (event: ${event ?? 'unknown'}). Payload:\n\n${rawBody}\n\nProcess this event.`;
    }
    const action = typeof body['action'] === 'string' ? body['action'] : undefined;
    const issue = body['issue'] as Record<string, unknown> | undefined;
    const pr = body['pull_request'] as Record<string, unknown> | undefined;
    const subject = issue ?? pr;
    const title = typeof subject?.['title'] === 'string' ? subject['title'] : undefined;
    const bodyText = typeof subject?.['body'] === 'string' ? subject['body'] : undefined;

    if (title === undefined) {
      return `Inbound GitHub webhook "${path}" (event: ${event ?? 'unknown'}${action ? `, action: ${action}` : ''}). Payload (JSON):\n\n${rawBody}\n\nProcess this event.`;
    }

    const lines = [
      `GitHub ${event ?? 'event'}${action ? ` (${action})` : ''}: ${title}`,
      bodyText ? `\n${bodyText}` : '',
    ];
    return lines.join('');
  },
};

export const WEBHOOK_ADAPTERS: Record<string, WebhookAdapter> = { generic, slack, github };

/** Provider-standard secret env var for the built-in adapters. Descriptor-driven
 *  providers carry their own `secretEnv` and don't need an entry here. */
const PROVIDER_SECRET_ENV: Record<string, string> = {
  slack: 'SLACK_SIGNING_SECRET',
  github: 'GITHUB_WEBHOOK_SECRET',
};

// ── descriptor-driven generic engine ───────────────────────────────────────

/** Case-insensitive header read. */
function header(headers: Record<string, string>, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

/** Concatenate the byte string a signature is computed over. */
function computeSigned(parts: SignedPart[] | undefined, rawBody: string, headers: Record<string, string>): string {
  if (!parts || parts.length === 0) return rawBody;
  let out = '';
  for (const p of parts) {
    if (p === 'body') out += rawBody;
    else if (typeof p === 'object' && 'header' in p) out += header(headers, p.header) ?? '';
    else if (typeof p === 'object' && 'literal' in p) out += p.literal;
  }
  return out;
}

/** Top-level fields of a JSON body, each stringified (for `body-token`). */
function jsonFields(rawBody: string): Record<string, string> {
  const obj = tryParseJson(rawBody);
  const out: Record<string, string> = {};
  if (obj) for (const [k, v] of Object.entries(obj)) if (v != null) out[k] = String(v);
  return out;
}

/** Verify per a declarative {@link VerifySpec}. Never throws — false on any error. */
function verifyFromSpec(
  spec: VerifySpec,
  rawBody: string,
  headers: Record<string, string>,
  secret: string | undefined,
): boolean {
  try {
    switch (spec.type) {
      case 'none':
        return true;
      case 'header-equals': {
        if (!secret) return false;
        const got = header(headers, spec.header);
        return typeof got === 'string' && safeEqual(got, secret);
      }
      case 'body-token': {
        if (!secret) return false;
        const fields =
          spec.bodyType === 'form'
            ? formDecode(rawBody)
            : spec.bodyType === 'json'
              ? jsonFields(rawBody)
              : tryParseJson(rawBody)
                ? jsonFields(rawBody)
                : formDecode(rawBody);
        const got = fields[spec.field];
        return typeof got === 'string' && safeEqual(got, secret);
      }
      case 'hmac': {
        if (!secret) return false;
        const got = header(headers, spec.header);
        if (!got) return false;
        if (spec.skewHeader && spec.maxSkewSeconds != null) {
          const ts = Number(header(headers, spec.skewHeader));
          const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
          if (!Number.isFinite(skew) || skew > spec.maxSkewSeconds) return false;
        }
        const signed = computeSigned(spec.signed, rawBody, headers);
        const mac = createHmac(spec.algo, secret).update(signed, 'utf8').digest(spec.encoding);
        return safeEqual(got, (spec.prefix ?? '') + mac);
      }
      case 'ed25519': {
        if (!secret) return false;
        const sig = header(headers, spec.sigHeader);
        if (!sig) return false;
        const signed = spec.signed
          ? computeSigned(spec.signed, rawBody, headers)
          : (spec.tsHeader ? header(headers, spec.tsHeader) ?? '' : '') + rawBody;
        return verifyEd25519(secret, signed, sig);
      }
      case 'twilio': {
        if (!secret) return false;
        const sig = header(headers, 'x-twilio-signature');
        const url = header(headers, 'x-lmthing-inbound-url');
        if (!sig || !url) return false; // no forwarded URL ⇒ can't reconstruct the base
        const params = formDecode(rawBody);
        const base = Object.keys(params)
          .sort()
          .reduce((acc, k) => acc + k + params[k], url);
        const mac = createHmac('sha1', secret).update(base, 'utf8').digest('base64');
        return safeEqual(sig, mac);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** Answer a declarative {@link PreflightSpec} handshake, or null. */
function preflightFromSpec(
  spec: PreflightSpec,
  rawBody: string,
): { status: number; body: unknown } | null {
  const body = tryParseJson(rawBody);
  if (!body) return null;
  if (body[spec.when.field] !== spec.when.equals) return null;
  if (spec.respondEcho) return { status: 200, body: { [spec.respondEcho.field]: body[spec.respondEcho.field] } };
  return { status: 200, body: spec.respond ?? {} };
}

/** Walk a dotted path (`a.b.c`) into a parsed JSON object. */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Derive a thread key per a declarative {@link ThreadSpec}, or null. */
function extractThreadFromSpec(
  spec: ThreadSpec | undefined,
  rawBody: string,
  headers: Record<string, string>,
): string | null {
  if (!spec) return null;
  let val: unknown;
  if (spec.from === 'body') {
    const obj = tryParseJson(rawBody);
    val = obj ? getPath(obj, spec.path) : undefined;
  } else if (spec.from === 'form') {
    val = formDecode(rawBody)[spec.field];
  } else {
    val = header(headers, spec.header);
  }
  if (val === null || val === undefined || val === '') return null;
  return spec.prefix ? `${spec.prefix}:${String(val)}` : String(val);
}

/** Passthrough render: hand the raw verified payload to the space's handler
 *  agent, which parses it per its own instructions/knowledge and replies via
 *  `callConnection`. No per-provider field extraction in the pod. */
function descriptorRender(provider: string, path: string, rawBody: string): string {
  return (
    `Inbound ${provider} event on "${path}":\n\n${rawBody}\n\n` +
    `[inbound-context] ${JSON.stringify({ provider, path })}\n\n` +
    `Parse this event per your instructions and reply via callConnection('${provider}', …) if a response is warranted.`
  );
}

/** Build a {@link WebhookAdapter} from a space's declarative descriptor.
 *
 *  An unauthenticated (`verify:{type:'none'}`) descriptor is honored ONLY when it
 *  explicitly sets `allowUnauthenticated: true`; otherwise it fails CLOSED
 *  (rejects every request) so a space can't accidentally/sneakily expose an
 *  unsigned webhook that wakes the pod + runs an agent for any anonymous caller. */
export function buildAdapterFromDescriptor(desc: WebhookDescriptor): WebhookAdapter {
  const unauthenticated = desc.verify.type === 'none';
  const permitted = !unauthenticated || desc.allowUnauthenticated === true;
  return {
    requiresSecret: !unauthenticated,
    verify: (rawBody, headers, secret) => (permitted ? verifyFromSpec(desc.verify, rawBody, headers, secret) : false),
    extractThread: (rawBody, headers) => extractThreadFromSpec(desc.thread, rawBody, headers),
    renderMessage: (path, rawBody) => descriptorRender(desc.provider, path, rawBody),
    preflight: desc.preflight ? (rawBody) => preflightFromSpec(desc.preflight!, rawBody) : undefined,
  };
}

// ── public lookup surface ──────────────────────────────────────────────────

/**
 * Resolve the adapter for a binding. A space `descriptor` (from
 * `integration-manifests.ts`) wins — it's built into a generic adapter. Else a
 * built-in (`slack`/`github`/`generic`), falling back to `generic` for an
 * unknown/unconfigured provider so a bad manifest entry degrades gracefully.
 */
export function getAdapter(provider: string, descriptor?: WebhookDescriptor): WebhookAdapter {
  if (descriptor) return buildAdapterFromDescriptor(descriptor);
  return WEBHOOK_ADAPTERS[provider] ?? generic;
}

// ── webhook EMITTER DEF adapter (S5) ─────────────────────────────────────────

/** A webhook emitter def's DATA fields — the {@link WebhookEmitterDef} minus its
 *  pure `emit` (which runs worker-isolated at dispatch, never in the verify path).
 *  This is the `SerializedEmitterDef` (emitter-manifests.ts) narrowed to the
 *  webhook kind. */
export type WebhookEmitterFields = Omit<WebhookEmitterDef, 'emit'>;

/** Everything `routes/webhooks.ts` needs to authenticate a webhook emitter def's
 *  inbound: the verify/preflight {@link WebhookAdapter}, the resolved signing
 *  `secret`, and a GET subscription-verification `challenge` answerer. */
export interface EmitterWebhookAdapter {
  adapter: WebhookAdapter;
  /** Resolved signing secret / public key / auth token (or `undefined`). */
  secret: string | undefined;
  /** Answer a GET `hub-challenge` handshake from the def's `challenge` spec, or
   *  null (descriptor-style only — the builtin shorthand uses a POST preflight). */
  challenge(query: URLSearchParams): { status: number; body: string } | null;
}

/**
 * Resolve a webhook emitter def's verification into the SAME {@link WebhookAdapter}
 * surface the legacy descriptor/builtin path uses — so the inbound route runs ONE
 * verify → preflight → challenge gate for both binding kinds.
 *
 *   - `verify: { type:'builtin', provider }` → the shipped inline slack/github
 *     adapter (Slack's clock-skew guard + `url_verification` preflight; GitHub's
 *     HMAC), with its provider-standard secret env. These schemes are NOT
 *     expressible in the declarative union, so they stay code.
 *   - a declarative {@link VerifySpec} → {@link buildAdapterFromDescriptor}, fed a
 *     descriptor synthesized from the def's own `verify`/`secretEnv`/`challenge`.
 *     An emitter def carries no `preflight`/`thread` (its pure `emit` replaces
 *     thread extraction + rendering), so only the GET `hub-challenge` echo applies.
 *
 * Secret precedence is IDENTICAL to the legacy path ({@link resolveWebhookSecret}):
 * per-path override → def `secretEnv` → builtin provider env.
 */
export function adapterForEmitterDef(def: WebhookEmitterFields): EmitterWebhookAdapter {
  if (def.verify.type === 'builtin') {
    const provider = def.verify.provider; // 'slack' | 'github'
    return {
      adapter: WEBHOOK_ADAPTERS[provider] ?? generic,
      secret: resolveWebhookSecret(def.path, provider, undefined),
      // Builtin providers handshake via a POST preflight (Slack `url_verification`),
      // never a GET hub-challenge — so there is nothing to answer on GET.
      challenge: () => null,
    };
  }
  // Descriptor-style: synthesize a WebhookDescriptor from the def's own fields.
  // `provider` feeds only descriptorRender (unused in emitter dispatch — we run the
  // def's pure `emit`, never renderMessage); a fixed label keeps the shape honest.
  const descriptor: WebhookDescriptor = {
    provider: 'emitter',
    ...(def.secretEnv ? { secretEnv: def.secretEnv } : {}),
    verify: def.verify,
    ...(def.challenge ? { challenge: def.challenge } : {}),
  };
  return {
    adapter: buildAdapterFromDescriptor(descriptor),
    secret: resolveWebhookSecret(def.path, 'emitter', descriptor),
    challenge: (query) => resolveChallenge(descriptor, query),
  };
}

/**
 * Resolve the signing secret for one webhook binding, checked in order:
 *   1. a per-path override, `LMTHING_WEBHOOK_SECRET_<PATH>` (`path` upper-cased,
 *      `-` → `_`) — lets one project pin a distinct secret per binding;
 *   2. the space descriptor's `secretEnv` (self-contained providers), else the
 *      built-in provider-standard env (`SLACK_SIGNING_SECRET`, …);
 *   3. `undefined` — no secret configured (a `requiresSecret` adapter then
 *      rejects every request; `generic` allows unsigned requests through).
 */
export function resolveWebhookSecret(path: string, provider: string, descriptor?: WebhookDescriptor): string | undefined {
  const perPathEnv = `LMTHING_WEBHOOK_SECRET_${path.toUpperCase().replace(/-/g, '_')}`;
  const perPath = process.env[perPathEnv];
  if (perPath) return perPath;

  const envName = descriptor?.secretEnv ?? PROVIDER_SECRET_ENV[provider];
  if (envName) {
    const v = process.env[envName];
    if (v) return v;
  }
  return undefined;
}

/**
 * Answer a GET subscription-verification challenge (WhatsApp/Meta) per a
 * descriptor's `challenge` spec. Returns the plain-text body to echo (HTTP 200)
 * when the query's verify-token matches `process.env[verifyTokenEnv]`, else null
 * (the caller 4xxs). Only meaningful on GET.
 */
export function resolveChallenge(
  descriptor: WebhookDescriptor | undefined,
  query: URLSearchParams,
): { status: number; body: string } | null {
  const spec = descriptor?.challenge;
  if (!spec || spec.type !== 'hub-challenge') return null;
  const tokenParam = spec.tokenParam ?? 'hub.verify_token';
  const challengeParam = spec.challengeParam ?? 'hub.challenge';
  const expected = process.env[spec.verifyTokenEnv];
  const got = query.get(tokenParam);
  const challenge = query.get(challengeParam);
  if (!expected || got === null || challenge === null) return null;
  if (!safeEqual(got, expected)) return null;
  return { status: 200, body: challenge };
}
