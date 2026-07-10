/**
 * Shared types for the `callConnection` provider registry. Lives in its own file
 * so `connections.ts` (the resolver) and the per-provider registry can import them
 * without a circular dependency.
 */

/**
 * How the resolver attaches the user's token to an outbound provider request.
 * The default (omitted) is `bearer`. Note this is INDEPENDENT of `apiBase`
 * placeholder substitution (see {@link ProviderConfig.apiBase}) — a provider that
 * carries its token in the URL path uses `{token}` in `apiBase` with `auth:{kind:'none'}`.
 *
 * - `bearer`      — `Authorization: Bearer <token>` (Slack/GitHub/Google/Line/WhatsApp/Mattermost).
 * - `bot`         — `Authorization: Bot <token>` (Discord's bot scheme).
 * - `basic`       — `Authorization: Basic base64(<userEnv value>:<token>)` (Twilio SID:authToken).
 * - `query-token` — no auth header; the token is appended as a query param (Synology `?token=…`).
 * - `nextcloud-bot` — per-request HMAC bot signature: sets `X-Nextcloud-Talk-Bot-Random` +
 *                   `X-Nextcloud-Talk-Bot-Signature = hex HMAC-SHA256(secret, random + signedContent)`,
 *                   where `signedContent` is the JSON body's `message`/`reaction` field (Nextcloud signs
 *                   the content, not the whole envelope) or the raw body as a fallback.
 * - `none`        — attach no auth header (the credential is already in the base URL / path).
 */
export type AuthStyle =
  | { kind: 'bearer' }
  | { kind: 'bot' }
  | { kind: 'basic'; userEnv: string }
  | { kind: 'query-token'; param: string }
  | { kind: 'nextcloud-bot' }
  | { kind: 'none' };

/**
 * One bring-your-own-token provider.
 *
 * @property apiBase  Where the REST API lives. Either:
 *   - a constant string, which may contain placeholders resolved per request:
 *     `{token}` → the `tokenEnv` value (Telegram `…/bot{token}`), and
 *     `{env:VAR_NAME}` → `process.env[VAR_NAME]` (WhatsApp `…/{env:WHATSAPP_PHONE_ID}`); or
 *   - an env-resolved base for self-hosted servers: `{ env: 'MATTERMOST_BASE_URL', suffix: '/api/v4' }`.
 * @property tokenEnv The pod env var holding the user's own token / secret.
 * @property auth     Auth style; defaults to `bearer` when omitted.
 */
export interface ProviderConfig {
  apiBase: string | { env: string; suffix?: string };
  tokenEnv: string;
  auth?: AuthStyle;
}
