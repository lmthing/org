#!/usr/bin/env node
/**
 * Live-verification helper for scenario 06. The runtime seed fix (`writeProjectTable(rows)` +
 * `db:write`) ships in the compute IMAGE the pod runs, but two of the fixes are PROMPT changes to
 * materialized system spaces (THING's path-4a routing + compound-request handling, and the
 * automator's data-in guidance). A locally-modified system space is held back by `syncSystemSpaces`
 * (runtime-init.ts), so writing the patched instructs into the pod's materialized copy survives the
 * restart the runner triggers — letting us verify the prompt fixes live WITHOUT another image build.
 *
 * Run BEFORE run.mjs, against the SAME cached tanzania user. Assumes the pod already runs a compute
 * image that carries the runtime seed fix (upgrade it with `kubectl set image … compute:<tag>` first).
 */
import { readFileSync } from 'node:fs';
import { loadUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

const user = await loadUser('tanzania');
if (!user) throw new Error('no cached tanzania user — run `node provision.mjs tanzania` first');
const pod = new Pod({ base: user.pod, token: user.token });

const patches = [
  {
    src: `${SDK_ORG}/libs/core/system-spaces/user-thing/agents/thing/instruct.md`,
    dest: 'system/spaces/user-thing/agents/thing/instruct.md',
    // routing to the automator for an in-project app, + compound-request handling
    markers: ['path 4a', 'NAME MORE THAN ONE', 'automator'],
  },
  {
    src: `${SDK_ORG}/libs/core/system-spaces/system-appbuilder/agents/automator/instruct.md`,
    dest: 'system/spaces/system-appbuilder/agents/automator/instruct.md',
    // the three data-in paths + the seed-rows arg
    markers: ['MOVE IN', 'db:write', 'UPDATING existing data'],
  },
];

let ok = true;
for (const p of patches) {
  const content = readFileSync(p.src, 'utf8');
  await pod.writeFile(p.dest, content);
  const back = await pod.readFile(p.dest).catch(() => ({ content: '' }));
  const hit = p.markers.every((m) => back.content.includes(m));
  console.log(`${hit ? '✓' : '✗'} patched ${p.dest} (${content.length} bytes)${hit ? '' : ' — MISSING markers'}`);
  ok = ok && hit;
}
process.exit(ok ? 0 : 1);
