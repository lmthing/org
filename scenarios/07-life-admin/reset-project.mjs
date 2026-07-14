#!/usr/bin/env node
/**
 * Drop the scenario's project + its checkpoint so Act I can be re-run from a CLEAN slate on the
 * SAME provisioned user (re-provisioning would also mean re-raising MAX_SESSIONS on a new namespace).
 *
 * Used after a product fix that changes what the BUILD produces: the old project still carries the
 * pre-fix damage (duplicate tables/rows), so re-running Act I against it would grade the fix on a
 * dirty baseline.
 *
 *   cd sdk/org/scenarios/harness && node ../07-life-admin/reset-project.mjs
 */
import { rmSync, existsSync } from 'node:fs';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

const PROJECT = 'life-admin';
const user = await getUser('07-life-admin');
const pod = new Pod({ base: user.pod, token: user.token });

const before = await pod.listProjects();
console.log('projects before:', (before.projects ?? []).map((p) => p.id ?? p).join(', '));

await pod.deleteProject(PROJECT).catch((e) => console.log(`delete ${PROJECT}: ${e.message}`));

const after = await pod.listProjects();
console.log('projects after: ', (after.projects ?? []).map((p) => p.id ?? p).join(', '));

const cp = `${SDK_ORG}/scenarios/07-life-admin/results/checkpoint.json`;
if (existsSync(cp)) {
  rmSync(cp);
  console.log('removed checkpoint');
}
console.log('✓ clean slate — re-run: node ../07-life-admin/run.mjs --acts=1');
