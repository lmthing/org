/**
 * provider.mjs — is the model provider actually reachable?
 *
 * A scenario run is hours of real LLM work, and when the provider goes away every turn fails
 * identically: the stream retries three times, gives up, and the channel posts an honest "could not
 * complete". That is the RIGHT behaviour, and it looks exactly like a product defect in the
 * evidence — 20-studio run 3 lost ten steps to an Azure connect-timeout and every one of them
 * recorded a failed turn with no hint of why.
 *
 *   Cannot connect to API: Connect Timeout Error
 *     (attempted address: lmthing-resource.openai.azure.com:443, timeout: 10000ms)
 *   Stream error: Failed after 3 attempts.
 *
 * So: check before a run starts, and read the server's own log when a step fails. A run that died of
 * an outage must be marked VOID, not written up as a finding. "A scenario suite that reports an
 * outage as a product defect is worse than one that does not run."
 *
 * The check is a bare TCP connect to the endpoint's :443 — the same thing that timed out. It needs
 * no key, spends no tokens, and cannot itself fail for a reason we would misread.
 */
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SDK_ORG } from './paths.mjs';

/** The provider hosts a run depends on, read from `sdk/org/.env` (the same file the pod is given). */
export function providerHosts(envPath = join(SDK_ORG, '.env')) {
  let text = '';
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return [];
  }
  const get = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const hosts = [];
  const resource = get('AZURE_RESOURCE_NAME');
  if (resource) hosts.push({ label: 'azure', host: `${resource}.openai.azure.com`, port: 443 });
  for (const key of ['LMTHINGCLOUD_BASE_URL', 'AZURE_API_BASE', 'OPENAI_BASE_URL']) {
    const raw = get(key);
    if (!raw) continue;
    try {
      const u = new URL(raw);
      hosts.push({ label: key.toLowerCase().replace(/_base_url|_api_base/, ''), host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) });
    } catch {
      /* not a URL — nothing to probe */
    }
  }
  return hosts;
}

/** One TCP connect, resolved either way — never throws. */
export function probeHost({ host, port, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = connect({ host, port });
    const done = (ok, error) => {
      socket.destroy();
      resolve({ host, port, ok, ms: Date.now() - t0, ...(error ? { error } : {}) });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, `connect timeout after ${timeoutMs}ms`));
    socket.once('error', (e) => done(false, String(e?.message ?? e)));
  });
}

/**
 * Are the model providers up? `{ ok, hosts }` — `ok` is false only when EVERY host is unreachable,
 * because a run needs one working provider, not all of them.
 */
export async function checkProvider({ timeoutMs = 8000 } = {}) {
  const hosts = providerHosts();
  if (!hosts.length) return { ok: true, hosts: [], note: 'no provider host found in sdk/org/.env — cannot check' };
  const results = await Promise.all(hosts.map((h) => probeHost({ ...h, timeoutMs })));
  return { ok: results.some((r) => r.ok), hosts: results };
}

/**
 * The provider-outage signatures a pod writes to its own log.
 *
 * Matched against the run's `sessions.log` when a step fails, so an outage is attributed rather than
 * filed. These are the exact strings the stream layer emits; a turn that "gave up after its final
 * retry" is only a product finding when NONE of these appear.
 */
const OUTAGE = [
  /Cannot connect to API/i,
  /Connect Timeout Error/i,
  /Stream error: Failed after \d+ attempts/i,
  /ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ENOTFOUND/,
  /\b(429|503)\b.*(rate|capacity|overloaded)/i,
];

/**
 * Did the pod hit the provider during this window? Reads the tail of the run's log.
 *
 * @param {string} logFile      the run's `sessions.log`
 * @param {number} [sinceBytes] only look at what was written after this offset (the step's own slice)
 */
export function providerOutageInLog(logFile, sinceBytes = 0) {
  let text = '';
  try {
    const buf = readFileSync(logFile);
    text = buf.subarray(Math.max(0, sinceBytes)).toString('utf8');
  } catch {
    return null;
  }
  for (const re of OUTAGE) {
    const m = re.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - 100);
    return { signature: m[0], context: text.slice(start, m.index + 220).replace(/\s+/g, ' ').trim() };
  }
  return null;
}

/** Byte length of the log right now — the mark a step's slice starts at. */
export function logSize(logFile) {
  try {
    return readFileSync(logFile).length;
  } catch {
    return 0;
  }
}
