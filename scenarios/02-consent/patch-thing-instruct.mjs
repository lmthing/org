#!/usr/bin/env node
/**
 * Live-verification helper for scenario 02: the prod pod runs the DEPLOYED compute image, so the
 * THING instruct fix (store:read + the storeInspect pre-install existence guard) is not active
 * there until a new image ships. To verify the fix end-to-end against the live LLM WITHOUT a full
 * image build/deploy, we write the patched instruct into the pod's materialized system space and
 * let the scenario's own Step-0 restart reload it (a locally-modified system space is held back by
 * `syncSystemSpaces`, so the edit survives the restart — see runtime-init.ts).
 *
 * Run BEFORE run.mjs, against the SAME (freshly provisioned) user.
 */
import { readFileSync } from 'node:fs';
import { loadUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

const user = await loadUser('consent');
if (!user) throw new Error('no cached consent user — run `node provision.mjs consent` first');
const pod = new Pod({ base: user.pod, token: user.token });

const src = `${SDK_ORG}/libs/core/system-spaces/user-thing/agents/thing/instruct.md`;
const content = readFileSync(src, 'utf8');
const destRel = 'system/spaces/user-thing/agents/thing/instruct.md';

await pod.writeFile(destRel, content);
console.log(`patched pod THING instruct (${content.length} bytes) → ${destRel}`);

// Sanity: the write landed and carries the fix markers.
const back = await pod.readFile(destRel).catch(() => ({ content: '' }));
const ok = back.content.includes('storeInspect') && back.content.includes('store:read');
console.log(ok ? '✓ pod instruct carries store:read + storeInspect guard' : '✗ pod instruct MISSING the fix markers');
process.exit(ok ? 0 : 1);
