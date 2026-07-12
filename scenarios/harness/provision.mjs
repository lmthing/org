#!/usr/bin/env node
/**
 * Stand up a disposable prod test user and print its session JSON.
 *
 *   node provision.mjs <label>            # register + pod + env + wait ready
 *   node provision.mjs <label> --reuse    # reuse the cached user for <label> if it exists
 *
 * Writes `.state/users/<label>.json` (gitignored) so a scenario can be re-run against the same
 * user, and so a subagent that hits a budget wall can just provision a new one and carry on.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  provisionUser,
  budget,
  podBase,
  agentEnvFromSdk,
  mergePodEnv,
  waitPodReady,
  waitPodSettled,
} from './lib/gateway.mjs';
import { STATE_DIR } from './lib/paths.mjs';

const label = process.argv[2] ?? 'scn';
const reuse = process.argv.includes('--reuse');
const file = `${STATE_DIR}/users/${label}.json`;

/** Load a cached user, refreshing its JWT (12h TTL) and re-asserting pod env. */
export async function loadUser(lbl = label) {
  const f = `${STATE_DIR}/users/${lbl}.json`;
  if (!existsSync(f)) return null;
  const u = JSON.parse(readFileSync(f, 'utf8'));
  const { mintSession } = await import('./lib/jwt.mjs');
  const session = mintSession(u.userId, u.email); // always re-mint: cheap, never stale
  return { ...u, session, token: session.accessToken, pod: podBase() };
}

/** Provision (or reuse) and guarantee: pod exists, agent keys loaded, pod ready. */
export async function getUser(lbl = label, { fresh = false } = {}) {
  if (!fresh) {
    const cached = await loadUser(lbl);
    if (cached) {
      // Re-assert env (a no-op PUT is skipped, so this usually does NOT restart the pod).
      const { changed } = await mergePodEnv(cached.token, agentEnvFromSdk()).catch(() => ({ changed: false }));
      await waitPodReady(cached.token).catch(() => {});
      if (changed) await waitPodSettled(cached.token);
      return cached;
    }
  }
  const u = await provisionUser({ label: lbl });
  mkdirSync(`${STATE_DIR}/users`, { recursive: true });
  writeFileSync(`${STATE_DIR}/users/${lbl}.json`, JSON.stringify({ email: u.email, userId: u.userId }, null, 2));
  return u;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await getUser(label, { fresh: !reuse });
  const b = await budget(u.token).catch((e) => ({ error: String(e) }));
  console.log(
    JSON.stringify(
      { label, email: u.email, userId: u.userId, pod: u.pod, token: u.token, budget: b },
      null,
      2,
    ),
  );
  console.log(`\n# pod namespace: user-${u.userId}\n# state: ${file}`);
}
