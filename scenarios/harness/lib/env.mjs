/**
 * env.mjs — merge/read the pod's `.env`-style content client-side, for the `set_env`/`blank_env`/
 * `restore_env` step verbs. `PUT /api/env` REPLACES the whole file (see
 * `libs/cli/src/server/routes/env.ts`'s `handleEnvPut`) — so every write here does a GET first,
 * merges the requested keys in, and PUTs the WHOLE content back; every OTHER var is left
 * byte-identical.
 *
 * Values never leave this module into evidence: `applyEnv` returns only the touched KEY NAMES (see
 * `08-small-shop`'s own invariant — `integrationStatus` reports missing var NAMES, never a value —
 * the harness holds itself to the same rule for credentials it injects on the step's behalf).
 */

/** Parse `KEY=VALUE` lines (skipping blanks/comments) into a Map, last-write-wins. */
export function parseEnvContent(content) {
  const map = new Map();
  for (const line of (content ?? '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    map.set(t.slice(0, eq).trim(), t.slice(eq + 1));
  }
  return map;
}

/**
 * Apply `updates` (a `{KEY: value}` map) onto `content`, REWRITING an existing `KEY=` line in place
 * (preserving every other line, comments included) and APPENDING any key absent from the file.
 * Pure — no I/O — so it's directly unit-testable.
 */
export function mergeEnvContent(content, updates) {
  const lines = (content ?? '').split('\n');
  // A trailing '\n' splits into a trailing '' element — drop it before appending new keys (else
  // an appended key lands after a spurious blank line), then always re-add exactly one at the end.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const applied = new Set();
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const eq = t.indexOf('=');
    if (eq === -1) return line;
    const key = t.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      applied.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!applied.has(key)) out.push(`${key}=${value}`);
  }
  return out.join('\n') + '\n';
}

/**
 * GET the pod's current `.env` content, merge `updates` in, PUT it back. Returns `{ keys,
 * previousContent }` — `previousContent` is the FULL pre-mutation content (so a later
 * `restore_env` can put it back verbatim); `keys` are the touched NAMES ONLY, safe to drop into
 * step evidence (a value never is, in either direction).
 */
export async function applyEnv(pod, updates) {
  const { content } = await pod.getEnv();
  const previousContent = content ?? '';
  await pod.putEnv(mergeEnvContent(previousContent, updates));
  return { keys: Object.keys(updates), previousContent };
}

/** Read one var's CURRENT value from the pod's env — needed to sign an inbound delivery with the
 *  secret the pod actually holds right now (see `webhook-sign.mjs`). Never logged by the caller. */
export async function readEnvVar(pod, key) {
  const { content } = await pod.getEnv();
  return parseEnvContent(content).get(key);
}
