/**
 * Provider registry for inbound webhooks (Phase 4a — pod side).
 *
 * One entry per provider bundles the three things `routes/webhooks.ts` needs
 * to safely dispatch an inbound event: signature verification (is this
 * request really from the provider?), thread extraction (which persisted
 * conversation, if any, does this event belong to?), and message rendering
 * (how does the raw request become the agent's user message?). A provider
 * may also define a synchronous `preflight` for setup handshakes (Slack's
 * `url_verification`) that must be answered without waking an agent.
 *
 * A per-provider registry (like the pod's `connections.ts` `PROVIDERS` map) —
 * adding a new provider is pure config/behavior, no dispatcher changes.
 * `getAdapter` falls back to `generic` for an unknown/unconfigured `provider`
 * string so a bad manifest entry degrades gracefully instead of 500ing.
 *
 * Every adapter method is defensive: a malformed body/header never throws
 * out of `verify`/`extractThread`/`renderMessage`/`preflight` — worst case
 * `verify` returns `false` (safe default: reject) and the others fall back to
 * embedding the raw body.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookAdapter {
  /** Verify the request authenticity. `secret` is the per-binding/provider
   *  signing secret (may be undefined). Return true when authentic (or when no
   *  verification applies). Never throw — return false on any parse/HMAC error. */
  verify(rawBody: string, headers: Record<string, string>, secret: string | undefined): boolean;
  /** A stable thread key for conversation continuity, or null for one-shot. */
  extractThread(rawBody: string, headers: Record<string, string>): string | null;
  /** Render the request into the agent's user message (plain text). */
  renderMessage(path: string, rawBody: string, headers: Record<string, string>): string;
  /** Optional synchronous pre-response (e.g. Slack url_verification handshake).
   *  Return { status, body } to short-circuit BEFORE waking any agent, or null. */
  preflight?(rawBody: string, headers: Record<string, string>): { status: number; body: unknown } | null;
  /** When true, a missing/invalid secret means reject (401). 'generic' with no
   *  secret configured is allowed (returns false here). */
  requiresSecret: boolean;
}

/** Constant-time compare of two hex/base64-ish strings. `timingSafeEqual`
 *  throws on a length mismatch, so guard that first — a length mismatch is
 *  itself just "not equal", not an error. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Parse `rawBody` as JSON, returning `undefined` (never throwing) on a
 *  non-JSON or non-object body. */
function tryParseJson(rawBody: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON body — caller falls back to the raw text.
  }
  return undefined;
}

// ── generic ──────────────────────────────────────────────────────────────

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

// ── slack ────────────────────────────────────────────────────────────────

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

// ── github ───────────────────────────────────────────────────────────────

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

/** Look up an adapter by provider id, falling back to `generic` for an
 *  unknown/unconfigured provider — a bad manifest entry degrades gracefully
 *  rather than 500ing the whole dispatch. */
export function getAdapter(provider: string): WebhookAdapter {
  return WEBHOOK_ADAPTERS[provider] ?? generic;
}

/** Provider-standard secret env var, keyed by provider id (Task 2). */
const PROVIDER_SECRET_ENV: Record<string, string> = {
  slack: 'SLACK_SIGNING_SECRET',
  github: 'GITHUB_WEBHOOK_SECRET',
};

/**
 * Resolve the signing secret for one webhook binding, checked in order:
 *   1. a per-path override, `LMTHING_WEBHOOK_SECRET_<PATH>` (`path` upper-cased,
 *      `-` → `_`) — lets one project pin a distinct secret per binding;
 *   2. the provider-standard env var (`SLACK_SIGNING_SECRET`,
 *      `GITHUB_WEBHOOK_SECRET`, …) — shared across all bindings for that
 *      provider on this pod;
 *   3. `undefined` — no secret configured (a `requiresSecret` adapter then
 *      rejects every request; `generic` allows unsigned requests through).
 */
export function resolveWebhookSecret(path: string, provider: string): string | undefined {
  const perPathEnv = `LMTHING_WEBHOOK_SECRET_${path.toUpperCase().replace(/-/g, '_')}`;
  const perPath = process.env[perPathEnv];
  if (perPath) return perPath;

  const providerEnv = PROVIDER_SECRET_ENV[provider];
  if (providerEnv) {
    const fromProvider = process.env[providerEnv];
    if (fromProvider) return fromProvider;
  }

  return undefined;
}
