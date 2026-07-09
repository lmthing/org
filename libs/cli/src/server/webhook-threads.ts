/**
 * Inbound-webhook thread-key store (Phase 2 — pod side).
 *
 * `<projectRoot>/.data/webhook-threads.json` maps an external thread key
 * (`<path>::<threadKey>`, so two different webhook paths never collide even if
 * an upstream provider reuses key values) to the stable `sessionId` that
 * thread's agent conversation lives under. `routes/webhooks.ts` looks up (or
 * mints) that id via {@link getOrCreateThreadSession} and hands it to
 * `SessionManager.runHeadlessThreaded`, so repeated events on the same thread
 * continue ONE persisted multi-turn session instead of a fresh one-shot each
 * time.
 *
 * Mirrors `app/hooks/state.ts`'s `.data/hooks-state.json` pattern: tolerant of
 * a missing/corrupt file (treated as empty — this is a cache, not the source
 * of truth for history; the snapshot itself is), `mkdir(..., {recursive:true})`
 * before writing.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

/** `key = "<path>::<threadKey>"` → the stable sessionId for that thread. */
export type WebhookThreadMap = Record<string, string>;

/** The canonical on-disk path for a project's webhook thread-key map. */
export function webhookThreadsPath(projectRoot: string): string {
  return join(projectRoot, '.data', 'webhook-threads.json');
}

/** Load the thread map, tolerating a missing/corrupt file (returns `{}`). */
async function loadWebhookThreads(projectRoot: string): Promise<WebhookThreadMap> {
  let text: string;
  try {
    text = await readFile(webhookThreadsPath(projectRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {}; // corrupt → start clean (state is a cache, not truth)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map: WebhookThreadMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') map[k] = v;
  }
  return map;
}

/** Persist the thread map (creating `.data/` if needed). */
async function saveWebhookThreads(projectRoot: string, map: WebhookThreadMap): Promise<void> {
  const path = webhookThreadsPath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf8');
}

/**
 * Look up (or mint) the stable `sessionId` for one webhook thread, keyed by
 * `${path}::${threadKey}`. Returns the existing id if this thread has been
 * seen before; otherwise generates a fresh `randomUUID()`, persists it, and
 * returns it. Concurrent-write-safe enough for a single-pod dispatcher: the
 * read-modify-write is not locked, but a lost-update here only means two
 * near-simultaneous FIRST events on a brand-new thread mint two ids (each
 * still runs its own valid — if separately-threaded — session); it never
 * corrupts an EXISTING thread's mapping.
 */
export async function getOrCreateThreadSession(projectRoot: string, path: string, threadKey: string): Promise<string> {
  const key = `${path}::${threadKey}`;
  const map = await loadWebhookThreads(projectRoot);
  const existing = map[key];
  if (existing) return existing;

  const sessionId = randomUUID();
  map[key] = sessionId;
  await saveWebhookThreads(projectRoot, map);
  return sessionId;
}
