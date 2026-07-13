/**
 * lmthing.cloud gateway client — everything a scenario needs to stand up a disposable prod
 * test user: register, provision the compute pod, load API keys into pod env, wake it.
 *
 * Budget note: scenarios burn real tokens. We deliberately load the **direct Azure** keys from
 * `sdk/org/.env` into the pod env (AZURE_API_KEY + AZURE_RESOURCE_NAME + the LM_MODEL_* aliases),
 * so agent traffic goes straight to Azure AI Foundry and never touches the per-user LiteLLM key
 * that carries the tier budget. A user therefore does not "run out" mid-scenario. `budget()` is
 * still exposed so a scenario can assert on spend, and `provisionUser()` is cheap enough to call
 * again if a pod ever does get budget-capped.
 */
import { readFileSync } from 'node:fs';
import { SDK_ORG } from './paths.mjs';
import { mintSession } from './jwt.mjs';
import { fetchResilient } from './pod.mjs';

export const GATEWAY = process.env.LM_GATEWAY ?? 'https://lmthing.cloud';

class HttpError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url} → ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function req(method, path, { token, body, base = GATEWAY } = {}) {
  const res = await fetchResilient(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) throw new HttpError(method, path, res.status, parsed);
  return parsed;
}

/** Parse `sdk/org/.env` into a plain object (no dotenv dep; ignores comments + blanks). */
export function readSdkEnv() {
  const raw = readFileSync(`${SDK_ORG}/.env`, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue; // comment or blank
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * The env vars a pod needs to run agents against Azure directly (budget-free), plus web search.
 * Anything absent from sdk/org/.env is simply omitted.
 */
export function agentEnvFromSdk() {
  const env = readSdkEnv();
  const keys = [
    'AZURE_API_KEY',
    'AZURE_RESOURCE_NAME',
    'TAVILY_API_KEY',
    'LM_MODEL_XS',
    'LM_MODEL_S',
    'LM_MODEL_M',
    'LM_MODEL_L',
    'LM_MODEL_M_R',
    'LM_MODEL_L_R',
    'LM_MODEL_VISION',
    'LM_TRANSCRIBE_MODEL',
  ];
  const out = {};
  for (const k of keys) if (env[k]) out[k] = env[k];
  return out;
}

/** `POST /api/auth/register` → { user_id, api_key }. Login is broken in prod; we mint instead. */
export async function register(email, password) {
  return req('POST', '/api/auth/register', { body: { email, password } });
}

export const ensurePod = (token) => req('POST', '/api/compute/ensure', { token });
export const podStatus = (token) => req('GET', '/api/compute/status', { token });
export const wakePod = (token) => req('POST', '/api/compute/wake', { token });

/**
 * Remaining LiteLLM budget. NOTE this lives on the POD (`routes/budget.ts` relays the caller's
 * Authorization to the gateway and computes the line with the master key) — there is no
 * `/api/budget` on the gateway itself. Scenarios run on direct Azure keys, so this is
 * informational: it tells you whether the tier key is exhausted, not whether the run can proceed.
 */
export const budget = (token) => req('GET', '/api/budget', { token, base: podBase() });

/**
 * `PUT /api/compute/env` REPLACES the whole var set, so always GET-merge-PUT — clobbering the
 * gateway-injected lmthingcloud creds would break the pod.
 *
 * A PUT rolls the deployment, and pod sessions are IN-MEMORY: any session created against the
 * old pod dies with it (`GET /api/sessions/:id/events` → 404 unknown session). So we skip the
 * write entirely when nothing would change — which is the common case on a reused test user.
 *
 * @returns {{merged: object, changed: boolean}}
 */
export async function mergePodEnv(token, vars) {
  const current = await req('GET', '/api/compute/env', { token }).catch(() => ({ vars: {} }));
  const existing = current.vars ?? {};
  const merged = { ...existing, ...vars };
  const changed = Object.entries(merged).some(([k, v]) => existing[k] !== v);
  if (!changed) return { merged, changed: false };
  await req('PUT', '/api/compute/env', { token, body: { vars: merged } });
  return { merged, changed: true };
}

/**
 * Wait until a session created NOW would survive — i.e. the env-triggered rollout is finished.
 *
 * There is no reliable "which pod process am I talking to" signal from outside, and the gateway's
 * `pod.ready` (readyReplicas > 0) stays true across a rolling update because the OLD replica is
 * still ready. So we test the property we actually need, directly: create a probe session, wait,
 * and confirm it still exists. If the pod rolled under us, the probe vanishes and we retry.
 */
export async function waitPodSettled(token, base = podBase(), { attempts = 6, settleMs = 9_000 } = {}) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId: 'user' }),
      });
      if (res.ok) {
        const { sessionId } = await res.json();
        await new Promise((r) => setTimeout(r, settleMs));
        const list = await fetch(`${base}/api/sessions`, { headers }).then((r) => r.json());
        const alive = (list.sessions ?? []).some((s) => s.sessionId === sessionId);
        if (alive) {
          // Clean up the probe so it doesn't pollute the scenario's session list.
          await fetch(`${base}/api/sessions/${sessionId}`, { method: 'DELETE', headers }).catch(() => {});
          return true;
        }
      }
    } catch {
      /* pod mid-roll — retry */
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error('pod never settled: a freshly created session keeps disappearing');
}

/**
 * Poll until the gateway reports the pod ready (or throw).
 *
 * Readiness lives at `status.pod.ready` / `status.pod.stage === 'ready'` — NOT at the top level.
 * Note "ready" here means readyReplicas>0, which precedes Envoy actually wiring the woken
 * endpoint (see the pod-readiness-edge race); callers that immediately hit the pod should
 * tolerate one early 503, which `Pod.req` surfaces as a normal HttpError.
 */
export async function waitPodReady(token, { timeoutMs = 180_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await podStatus(token);
      if (last?.pod?.ready || last?.pod?.stage === 'ready') return last;
    } catch (err) {
      last = { error: String(err) };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pod not ready after ${timeoutMs}ms: ${JSON.stringify(last)}`);
}

/**
 * Full disposable-test-user provision: register → mint session → ensure pod → load agent keys →
 * wait ready. Returns everything a scenario needs, including a `pod` base URL.
 *
 * Pods are reached through the chat origin: Envoy validates the JWT and routes on the `sub` claim
 * to `lmthing.user-<id>.svc`, waking a scaled-to-zero pod on the way.
 */
export async function provisionUser({ label = 'scn', password = 'Test-Passw0rd!' } = {}) {
  const email = `${label}-${Date.now().toString(36)}@lmthing.test`;
  const { user_id: userId } = await register(email, password);
  const session = mintSession(userId, email);
  await ensurePod(session.accessToken);
  // Pod env must be loaded BEFORE the first agent turn: the PUT rolls the pod, and a restart
  // mid-scenario destroys in-memory sessions (it would look like a spurious failure).
  const { changed } = await mergePodEnv(session.accessToken, agentEnvFromSdk());
  await waitPodReady(session.accessToken);
  if (changed) await waitPodSettled(session.accessToken);
  return { email, password, userId, session, token: session.accessToken, pod: podBase() };
}

/** The origin that fronts a user's pod (Envoy routes by JWT `sub`). */
export const podBase = () => process.env.LM_POD_BASE ?? 'https://lmthing.chat';
