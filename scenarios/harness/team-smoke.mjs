#!/usr/bin/env node
/**
 * TEAM harness smoke test — the team-pod equivalent of `smoke.mjs`. Proves the whole chain before a
 * team scenario burns an hour on it:
 *
 *   team-mode run → a cast of three (two editors + one viewer) → a channel → member A `@thing`s a
 *   real LLM turn → member B replies IN THE SAME THREAD and THING answers with A's context →
 *   the viewer is genuinely refused a write.
 *
 *   node scenarios/harness/team-smoke.mjs            # from sdk/org
 *   node scenarios/harness/team-smoke.mjs --keep     # leave the run's server up for poking
 *   node scenarios/harness/team-smoke.mjs --ask      # + the park-on-a-question path (see below)
 *
 * `--ask` is opt-in because it depends on the model CHOOSING to call `ask()`, which no prompt can
 * guarantee; the rest of the smoke is deterministic and must stay that way. When it does ask, the
 * probe proves both halves of the contract: the driver reports the park instead of hanging, and a
 * reply in the thread answers the question and lets the suspended turn finish.
 *
 * The cross-member thread memory is the single most important property here: in a team channel the
 * THREAD owns the THING session, not the person, so what Ana told THING must be there when Bo asks.
 * That is the check to look at first if this goes red.
 *
 * The run lives under `harness/.state/team-smoke/runs/<n>/` (gitignored) and its server is killed on
 * every exit path.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startRun, stopRun, nextRunId, runsDir } from './lib/local.mjs';
import { STATE_DIR } from './lib/paths.mjs';
import { TeamPod } from './lib/team-pod.mjs';
import { ThreadSession } from './lib/team-thread.mjs';
import { Report } from './lib/report.mjs';

const KEEP = process.argv.includes('--keep');
const VERBOSE = process.argv.includes('--verbose');
const ASK = process.argv.includes('--ask');
const TEAM_ID = 'smoke-team';

const r = new Report('team-smoke', 'Team harness smoke test');
const scenarioDir = join(STATE_DIR, 'team-smoke');
mkdirSync(runsDir(scenarioDir), { recursive: true });

let run = null;
const teardown = () => {
  if (run && !KEEP) stopRun(run);
};
process.on('exit', teardown);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    teardown();
    process.exit(130);
  });
}

// ── 1. a team-mode pod ─────────────────────────────────────────────────────────────────────────
r.step('team pod', 'a per-run `lmthing serve` with LMTHING_TEAM_MODE=1 registers /api/team/*');
run = await startRun({
  scenarioDir,
  runId: nextRunId(scenarioDir),
  projectId: 'user',
  scenarioId: 'team-smoke',
  teamMode: true,
  teamId: TEAM_ID,
});
r.check('server up', !!run.base, `${run.base}  (run ${run.runId}, log ${run.logFile})`);

// No identity headers at all → 401. This is the proof that team mode is REALLY on: on a personal
// pod the same request is a plain 200, and /api/team/* would not exist.
const anon = await fetch(`${run.base}/api/team/channels`).then((res) => res.status);
r.check('anonymous caller refused (401)', anon === 401, `status ${anon}`);

// ── 2. the cast ────────────────────────────────────────────────────────────────────────────────
r.step('cast', 'two editors and a viewer exist in the directory under typeable handles');
const pod = new TeamPod({
  base: run.base,
  teamId: TEAM_ID,
  verbose: VERBOSE,
  members: [
    { name: 'ana', role: 'editor', handle: 'ana', displayName: 'Ana' },
    { name: 'bo', role: 'editor', handle: 'bo', displayName: 'Bo' },
    { name: 'vic', role: 'viewer', handle: 'vic', displayName: 'Vic' },
  ],
});
await pod.introduceAll();
const { members } = await pod.directory('ana');
const handles = (members ?? []).map((m) => m.handle).sort();
r.check('directory holds the whole cast', (members ?? []).length === 3, JSON.stringify(handles));

// ── 3. a channel ───────────────────────────────────────────────────────────────────────────────
r.step('channel', 'an editor creates a channel; a viewer may read it but not create one');
const { channel } = await pod.createChannel('ana', 'Launch Smoke');
r.check('editor created a channel', !!channel?.id, `#${channel?.id}`);

const viewerRead = await pod.request('vic', 'GET', '/api/team/channels', undefined, { raw: true });
r.check('viewer may READ the channel list', viewerRead.status === 200, `status ${viewerRead.status}`);

// ── 3b. the rest of the client surface, without spending a token ────────────────────────────────
// Every TeamPod method runs against the real routes here: an untested client method is a scenario
// that fails for a reason that has nothing to do with the product.
r.step('client surface', 'categories, DMs, mark-read and message paging all answer as themselves');
const { category } = await pod.createCategory('ana', 'Projects');
await pod.patchCategory('ana', category.id, { order: 2 });
const { channel: filed } = await pod.createChannel('ana', 'Design', { categoryId: category.id });
const sidebar = await pod.listChannels('ana');
r.check('a channel can be filed under a category', sidebar.channels.find((c) => c.id === filed.id)?.categoryId === category.id, `${filed.id} → ${category.id}`);
r.check('categories list with the order they were given', (sidebar.categories ?? []).some((c) => c.id === category.id && c.order === 2), JSON.stringify(sidebar.categories));

const { channel: dm } = await pod.createDm('ana', 'bo');
r.check('a DM is a channel with kind=dm and two members', dm.kind === 'dm' && dm.members?.length === 2, `${dm.id} ${JSON.stringify(dm.members)}`);
await pod.postMessage('ana', dm.id, 'Bo — quick one before standup.');
const boSees = await pod.listMessages('bo', dm.id);
r.check('the other participant reads the DM', (boSees.messages ?? []).length === 1, boSees.messages?.[0]?.text ?? '(none)');
// A DM nobody invited you to must be indistinguishable from one that does not exist: 404, not 403.
const vicPeeks = await pod.request('vic', 'GET', `/api/team/channels/${dm.id}/messages`, undefined, { raw: true });
r.check('an outsider cannot see the DM exists (404)', vicPeeks.status === 404, `status ${vicPeeks.status}`);
r.check('and it is absent from their sidebar', !(await pod.listChannels('vic')).channels.some((c) => c.id === dm.id), (await pod.listChannels('vic')).channels.map((c) => c.id).join(', '));

const read = await pod.request('bo', 'POST', `/api/team/channels/${channel.id}/read`, undefined, { raw: true });
r.check('mark-read answers ok', read.status === 200, `status ${read.status}`);

await pod.deleteCategory('ana', category.id);
const afterDelete = await pod.listChannels('ana');
r.check('deleting a category leaves its channels uncategorized', !afterDelete.channels.find((c) => c.id === filed.id)?.categoryId, `${filed.id} categoryId=${afterDelete.channels.find((c) => c.id === filed.id)?.categoryId ?? 'none'}`);

// ── 4. the LLM turn ────────────────────────────────────────────────────────────────────────────
r.step('THING in a thread', 'an @thing mention runs a real LLM turn and answers in the thread');
const thread = new ThreadSession(pod, { channelId: channel.id, observeAs: 'ana', verbose: VERBOSE });
await thread.open();

const t1 = await thread.ask(
  'ana',
  '@thing Please remember two facts for this team: our launch codename is Bluefin, and the launch date is 14 March 2027. Reply in one short sentence confirming you have them.',
);
r.check('turn reached a terminal thing_status', t1.status === 'done', `status=${t1.status} in ${(t1.durationMs / 1000).toFixed(1)}s`);
r.check('THING actually replied', t1.text.trim().length > 0, t1.text.slice(0, 200));
r.check('the reply is stored in the thread', !!t1.reply?.threadId, `threadId=${t1.threadId} messageId=${t1.reply?.id}`);
r.check('the reply carries a session id', !!t1.sessionId, t1.sessionId ?? '(none)');
r.note(`blocks: ${t1.blocks ? `${t1.blocks.length} display descriptor(s) — ${t1.blocks.map((b) => b?.type).join(', ')}` : 'none (prose reply)'}`);
r.metric('turn 1', (t1.durationMs / 1000).toFixed(1), 's');

// ── 5. cross-member thread memory ──────────────────────────────────────────────────────────────
r.step(
  'cross-member memory',
  'a DIFFERENT member replying in the same thread reaches the same session and gets Ana\'s facts back',
);
const t2 = await thread.say(
  'bo',
  'This is Bo. Without asking anyone, what launch codename and launch date did Ana just give you? Answer in one short sentence.',
);
r.check('second turn completed', t2.status === 'done', `status=${t2.status} in ${(t2.durationMs / 1000).toFixed(1)}s`);
r.check('same THING session as Ana\'s turn', !!t2.sessionId && t2.sessionId === t1.sessionId, `${t1.sessionId} → ${t2.sessionId}`);
const answer = `${t2.text}`.toLowerCase();
r.check('Bo\'s answer carries a fact only Ana\'s turn supplied', answer.includes('bluefin'), t2.text.slice(0, 240));
r.metric('turn 2', (t2.durationMs / 1000).toFixed(1), 's');
// The DATE is deliberately an observation, not a check. Whether THING also recalls the second fact
// depends on what it chose to write to memory — a memory-policy question, not thread continuity —
// and one observed run answered "codename Bluefin — the launch date wasn't stored". Asserting it
// would make this smoke fail for a reason that has nothing to do with the harness or the thread.
r.note(`launch date recalled too: ${/14\s*(th)?\s*(march|mar)|march\s*14|2027-03-14/.test(answer) ? 'yes' : 'NO (THING kept only the codename)'}`);

// Bo never typed `@thing`: inside a thread THING is already in, every reply addresses it.
r.note('Bo\'s follow-up carried no @thing mention — implicit addressing inside a THING thread');

// ── 6. the viewer is genuinely read-only ───────────────────────────────────────────────────────
r.step('viewer enforcement', 'a viewer may talk, but every configuring write is refused with 403');
const vTalk = await pod.request('vic', 'POST', `/api/team/channels/${channel.id}/messages`, { text: 'Vic here, reading along.' }, { raw: true });
r.check('viewer MAY post a message (201)', vTalk.status === 201, `status ${vTalk.status}`);

const vCreate = await pod.request('vic', 'POST', '/api/team/channels', { name: 'viewer-channel' }, { raw: true });
r.check('viewer may NOT create a channel (403)', vCreate.status === 403, `status ${vCreate.status}: ${JSON.stringify(vCreate.body).slice(0, 120)}`);

const vPatch = await pod.request('vic', 'PATCH', `/api/team/channels/${channel.id}`, { name: 'renamed-by-a-viewer' }, { raw: true });
r.check('viewer may NOT rename a channel (403)', vPatch.status === 403, `status ${vPatch.status}`);

const vCategory = await pod.request('vic', 'POST', '/api/team/categories', { name: 'nope' }, { raw: true });
r.check('viewer may NOT create a category (403)', vCategory.status === 403, `status ${vCategory.status}`);

// The refusal must be REAL, not just a status code: nothing may have been written.
const after = await pod.listChannels('ana');
const names = (after.channels ?? []).map((c) => c.id);
r.check('no channel the viewer asked for exists', !names.includes('viewer-channel'), names.join(', '));
r.check('the channel still has its original name', after.channels.find((c) => c.id === channel.id)?.name === channel.name, `${after.channels.find((c) => c.id === channel.id)?.name}`);

// ── 7. the thread log ──────────────────────────────────────────────────────────────────────────
r.step('thread log', 'the whole conversation is on disk in one thread, from three different posters');
const logged = await pod.threadMessages('ana', channel.id, thread.threadId);
const kinds = logged.map((m) => `${m.kind}${m.userId ? `:${m.userId}` : ''}`);
r.check('thread holds both asks and both answers', logged.length >= 4, `${logged.length} messages — ${kinds.join(' | ')}`);
r.check('two different members posted into it', new Set(logged.filter((m) => m.kind === 'user').map((m) => m.userId)).size === 2, JSON.stringify([...new Set(logged.filter((m) => m.kind === 'user').map((m) => m.userId))]));

// ── 8. (opt-in) THING parks the thread on a question, and a reply answers it ───────────────────
if (ASK) {
  r.step('ask + answer', 'a parked turn is REPORTED not hung, and a thread reply resumes it');
  const asking = new ThreadSession(pod, { channelId: channel.id, observeAs: 'ana', verbose: VERBOSE });
  await asking.open();

  // Deliberately NO onAsk: prove the driver returns the park instead of waiting forever.
  const parked = await asking.ask(
    'ana',
    '@thing Do not guess: call ask() to ask me whether the launch banner should be teal or amber, wait for my answer, then confirm my choice in one short sentence.',
    { onAsk: null, parkGraceMs: 25_000 },
  );
  r.check('THING parked on a question', parked.status === 'parked' && parked.asks.length === 1, `status=${parked.status} asks=${parked.asks.length}: ${(parked.asks[0]?.message?.text ?? '').slice(0, 160)}`);
  r.check('the question is stored as BLOCKS, not prose', !!parked.asks[0]?.message?.blocks?.length, JSON.stringify(parked.asks[0]?.message?.blocks ?? null).slice(0, 200));
  r.note(`the driver returned after ${(parked.durationMs / 1000).toFixed(1)}s instead of hanging on a suspended turn`);

  // The next message in the thread IS the answer (`answerPendingAsk`) — the suspended turn resumes
  // and finishes, which is the terminal `say()` waits for.
  const resumed = await asking.say('ana', 'Teal, please.');
  r.check('the reply answered the question and the turn finished', resumed.status === 'done', `status=${resumed.status} in ${(resumed.durationMs / 1000).toFixed(1)}s`);
  r.check('the answer reflects what was said', /teal/i.test(resumed.text), resumed.text.slice(0, 200));
  asking.close();
}

thread.close();
pod.closeSockets();

// ── the table ──────────────────────────────────────────────────────────────────────────────────
const s = r.summary();
console.log('\n┌─ team-smoke ───────────────────────────────────────────────────────────────');
for (const st of r.steps) {
  console.log(`│ ${st.checks.every((c) => c.pass) ? 'PASS' : 'FAIL'}  ${st.name}`);
  for (const c of st.checks) console.log(`│   ${c.pass ? '✓' : '✗'} ${c.label}${c.actual ? ` — ${c.actual.slice(0, 90)}` : ''}`);
}
console.log(`└─ ${r.passed ? 'PASS' : 'FAIL'} · ${s.passed}/${s.total} checks · run ${run.runId} · ${run.base}`);
r.save(join(STATE_DIR, 'team-smoke-report.md'));
if (KEEP) console.log(`\n(--keep) server left up at ${run.base} — stop it with: kill -9 -${run.serverPid}`);
process.exit(r.passed ? 0 : 1);
