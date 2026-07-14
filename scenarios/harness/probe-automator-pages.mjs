#!/usr/bin/env node
/**
 * Minimal repro: does system-appbuilder/automator author PAGES when asked for an app?
 *
 * Isolates the automator from THING entirely. On the 05-latam run THING's delegate query was
 * explicit ("Build a trip dashboard app INTO this live project ... a trip overview page ...") and
 * the automator returned 8 tables and ZERO pages — `/app/<id>/` then 404s. Its own instruct carries
 * an explicit gate ("not done until it serves at least one PAGE"). This probe asks it directly, on a
 * fresh project, so the answer cannot be blamed on THING's framing.
 *
 *   cd sdk/org/scenarios/harness && SCENARIO_TARGET=local node probe-automator-pages.mjs
 */
import { getUser } from './provision.mjs';
import { Pod } from './lib/pod.mjs';
import { ThingSession } from './lib/thing.mjs';

const PROJECT = `probe-pages-${Date.now().toString(36)}`;
const user = await getUser('latam');
const pod = new Pod({ base: user.pod, token: user.token });
await pod.createProject(PROJECT);
console.log(`project ${PROJECT}`);

// Talk to the automator DIRECTLY — same shape of request THING sends on a path-4a app build.
const s = new ThingSession(pod, {
  projectId: PROJECT,
  spaceRef: 'system-appbuilder/automator',
  onAsk: () => ({}),
  verbose: true,
});
await s.start();

const t = await s.send(
  'Build a reading-list app INTO this live project. Move this data in as seeded table rows: ' +
    '3 books (title/author/status): "Dune"/Herbert/reading, "Piranesi"/Clarke/finished, "Solaris"/Lem/unread. ' +
    'Also a notes table and a tags table. The app needs a home page listing the books with their status, ' +
    'and a page per book. Serve it at /app/<this-project>/. Make it mobile-friendly.',
  { timeoutMs: 900_000 },
);

const tree = await pod.fsTree();
const mine = (tree.files ?? []).filter((f) => f.startsWith(`${PROJECT}/`) && !f.includes('/sessions/'));
const of = (d) => mine.filter((f) => f.startsWith(`${PROJECT}/${d}/`));
const build = await pod.appBuild(PROJECT).catch((e) => ({ built: false, error: String(e) }));
const page = await pod.appPage(PROJECT).catch((e) => ({ status: 0, body: String(e) }));

console.log('\n──────── RESULT ────────');
console.log('tables :', of('database').map((f) => f.split('/').pop()).join(', ') || 'NONE');
console.log('pages  :', of('pages').map((f) => f.split('/').pop()).join(', ') || 'NONE  ← the empty-app failure');
console.log('api    :', of('api').length);
console.log('build  :', JSON.stringify({ built: build.built, routes: (build.routes ?? []).length }));
console.log('serve  :', `GET /app/${PROJECT}/ → ${page.status}`);
console.log('writers:', [...new Set(t.yields.map((y) => y.kind))].join(', '));
console.log('\nVERDICT:', of('pages').length > 0 ? '✅ automator authored pages' : '❌ REPRO — tables but ZERO pages');
process.exit(0);
