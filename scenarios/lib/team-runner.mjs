/**
 * team-runner.mjs — the reentrant TEAM scenario engine.
 *
 * The sibling of `runner.mjs`, for a scenario whose subject is a TEAM rather than one person. It
 * plays a `scenario.yaml` that declares a `team:`, a `cast:` and `channels:` against a per-run
 * `lmthing serve` booted in TEAM MODE, and writes the same evidence files (`step-NN.json`,
 * `step-NN.full.json`, `trace.md`, `summary.json`) — with the fields a team judge cannot do without:
 * **who** spoke, in **which channel**, in **which thread**, with **which role**.
 *
 * `runner.mjs` is untouched by all of this, and the eight personal scenarios play byte-identically.
 *
 * ── What is structurally different from a personal run ──────────────────────────────────────────
 *
 * 1. **There is no session to create.** A personal step drives `POST /api/sessions` and reads the
 *    execution trace back over `GET /api/sessions/:id/events`. A channel turn is started BY THE POD
 *    when a message mentions `@thing`, on a session keyed by (channel, thread) that is never
 *    registered in the manager (`runHeadlessThreaded`) — so there is no trace endpoint to poll. The
 *    turn is awaited over the channel socket instead (`ThreadSession`), and the "what did it
 *    actually DO" evidence comes from two other places: the pod-global **session ledger**
 *    (`GET /api/session-ledger` — the delegates each session made, with tokens) keyed by the reply's
 *    `sessionId`, and the **state snapshot** after the step.
 *
 * 2. **The project is discovered, not created.** `routes/team-channels.ts` runs a channel turn with
 *    no `projectId`, so it starts in the default `user` project and THING creates its own project if
 *    it decides to build one — exactly the `bootstrap: thing` shape. So the runner pre-creates
 *    nothing and rebinds `activeProject` to the first non-`system`/`user` project that appears.
 *
 * 3. **A refusal is a result.** A viewer's write is refused by `team-guard` with a 403 before any
 *    handler runs. That is the step PASSING, so the runner records `{status, body}` as evidence and
 *    does not throw. (Note that POSTING A MESSAGE is viewer-allowed by design — a viewer may talk.
 *    The refusal those steps are about is THING's own answer, which is the judge's to score.)
 *
 * ── Step verbs ──────────────────────────────────────────────────────────────────────────────────
 *
 *   as: <cast key>          who is speaking (required on a conversational step)
 *   in: <channel id>        which channel
 *   dm: <cast key>          speak in the DM between `as:` and this member
 *   say: <text>             the message, verbatim
 *   reply_to: <step number> continue the thread that step opened
 *   answer_ask: true        this message answers a question THING parked in that thread
 *   if_asked: {sub: answer} steer the persona's answer to an expected question
 *   expect_denied: true     the pod must REFUSE this write; the step passes on the refusal
 *   concurrent: [ {as, in|dm, say, reply_to?}, … ]   several members speaking in the same instant
 *   open_app · in_app_chat · restart_pod · run_emitter · expect      as in the personal runner
 */
import { writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TeamPod } from '../harness/lib/team-pod.mjs';
import { ThreadSession } from '../harness/lib/team-thread.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import {
  startRun,
  stopRun,
  restartRun,
  snapshotProject,
  snapshotDir,
  bumpCompletedSteps,
  nextRunId,
  reapOrphanRuns,
  readRunJson,
} from '../harness/lib/local.mjs';
import { checkProvider, providerOutageInLog, logSize } from '../harness/lib/provider.mjs';
import { snapshot, compactStep, traceLines, compact } from './evidence.mjs';
import { FatalError } from './errors.mjs';

export { FatalError } from './errors.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ── the plan ────────────────────────────────────────────────────────────────────────────────────

/**
 * The lines `--plan` prints for a TEAM scenario: the header, the cast with roles, the channels, then
 * one line per step showing WHO speaks WHERE and into which thread. A team scenario's plan has to
 * answer "who is in this, and who talks to whom" — the personal `planLines` cannot, and its fixture
 * audit is meaningless here (a channel has no attachment path today).
 */
export function teamPlanLines({ scenario, steps }) {
  const out = [];
  out.push(`team scenario ${scenario.id} — "${scenario.title}"`);
  out.push(`team: ${scenario.team?.name ?? '(unnamed)'} (${scenario.team?.id ?? '?'})  ·  nominal project: ${scenario.project}`);
  out.push(`persona: ${String(scenario.persona).slice(0, 90)}…`);
  const cast = scenario.cast ?? [];
  out.push(`cast (${cast.length}): ${cast.map((c) => `${c.key}<${c.role}>`).join(', ')}`);
  out.push(`channels (${(scenario.channels ?? []).length}): ${(scenario.channels ?? []).map((c) => `#${c.id}${c.category ? ` [${c.category}]` : ''}`).join(', ')}`);
  out.push(`invariants: ${scenario.invariants?.length ?? 0}  ·  knows: ${scenario.knows?.length ?? 0}  ·  steps: ${steps.length}\n`);

  const roleOf = new Map(cast.map((c) => [c.key, c.role]));
  steps.forEach((s, i) => {
    const verbs = Object.keys(s).filter((k) => k !== 'expect');
    const num = String(i + 1).padStart(2);
    if (s.concurrent) {
      out.push(`  ${num}. [concurrent × ${s.concurrent.length}]  ← the same instant, different threads`);
      for (const sub of s.concurrent) {
        out.push(`       · ${sub.as}<${roleOf.get(sub.as) ?? '?'}> in ${where(sub)}: ${line(sub.say)}`);
      }
    } else {
      const who = s.as ? `${s.as}<${roleOf.get(s.as) ?? '?'}>` : '—';
      const msg = line(s.say ?? s.in_app_chat ?? '');
      out.push(`  ${num}. [${verbs.join(', ')}]  ${who}${s.as ? ` in ${where(s)}` : ''}${msg ? `: ${msg}` : ''}`);
    }
    if (s.reply_to) out.push(`       ↳ replies in the thread step ${s.reply_to} opened`);
    if (s.answer_ask) out.push('       ↳ answers a question THING parked in that thread');
    if (s.expect_denied) out.push('       ↳ EXPECTS A REFUSAL (the step passes when the pod says no)');
    if (s.restart_pod) out.push('       ↳ restarts the pod first');
    if (s.run_emitter) out.push(`       run_emitter: ${typeof s.run_emitter === 'string' ? s.run_emitter : s.run_emitter.slug ?? `${s.run_emitter.scope}:${s.run_emitter.name}`}`);
    if (s.open_app) out.push('       open_app: build + check + fetch the served page');
    if (s.if_asked) out.push(`       if_asked: ${Object.keys(s.if_asked).length}`);
    out.push(`       expect: ${s.expect?.length ?? 0}`);
  });

  // Every `reply_to` must name a step that actually opens a thread — a typo here is a run that
  // silently opens a NEW thread and quietly stops testing the thing the scenario is about.
  const problems = validateTeamScenario({ scenario, steps });
  if (problems.length) {
    out.push('');
    for (const p of problems) out.push(`⚠️  ${p}`);
  } else {
    out.push('\n✅ every `as:` is in the cast, every `in:` is a declared channel, every `reply_to` names a thread-opening step');
  }
  return out;
}

const line = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 64);
const where = (s) => (s.dm ? `DM with ${s.dm}` : `#${s.in}`);

/** Static faults a `--plan` should catch before an hour of real LLM time is spent. */
export function validateTeamScenario({ scenario, steps }) {
  const problems = [];
  const castKeys = new Set((scenario.cast ?? []).map((c) => c.key));
  const channelIds = new Set((scenario.channels ?? []).map((c) => c.id));
  if (!scenario.team?.id) problems.push('no `team:` block — a team scenario needs `team: {id, name}`');
  if (!castKeys.size) problems.push('no `cast:` — a team scenario needs members');
  // A step "has a thread" once it has spoken — whether it opened one or replied into one, a later
  // step may name it. What must never resolve is a `reply_to` naming a step that never speaks (or
  // that has not run yet), because that silently opens a NEW thread and stops testing continuity.
  const speaks = steps.map((s) => (s.concurrent ? s.concurrent.some((x) => x.say != null) : s.say != null));
  steps.forEach((s, i) => {
    const num = i + 1;
    const subs = s.concurrent ?? [s];
    for (const sub of subs) {
      const isMessage = sub.say != null;
      if (sub.as && !castKeys.has(sub.as)) problems.push(`step ${num}: \`as: ${sub.as}\` is not in the cast`);
      if (sub.dm && !castKeys.has(sub.dm)) problems.push(`step ${num}: \`dm: ${sub.dm}\` is not in the cast`);
      if (sub.in && !channelIds.has(sub.in)) problems.push(`step ${num}: \`in: ${sub.in}\` is not a declared channel`);
      if (isMessage && !sub.as) problems.push(`step ${num}: a message needs \`as:\``);
      if (isMessage && !sub.in && !sub.dm) problems.push(`step ${num}: a message needs \`in:\` or \`dm:\``);
      const target = sub.reply_to ?? s.reply_to;
      if (target != null) {
        if (!Number.isInteger(target) || target < 1 || target >= num) {
          problems.push(`step ${num}: \`reply_to: ${target}\` must name an EARLIER step`);
        } else if (!speaks[target - 1]) {
          problems.push(`step ${num}: \`reply_to: ${target}\` — step ${target} says nothing, so it has no thread`);
        }
      }
    }
    if (s.answer_ask && s.reply_to == null) problems.push(`step ${num}: \`answer_ask\` needs \`reply_to:\` — a question is parked in a specific thread`);
  });
  return problems;
}

// ── evidence: the team fields the judge cannot read a step without ──────────────────────────────

/**
 * One channel turn as evidence. Deliberately NOT `evidence.mjs#summarizeTurn`: a channel turn has no
 * trace (see the module docblock), and it has four facts a personal turn does not — who, their role,
 * the channel and the thread. `delegates`/`tokens` are filled in from the session ledger by
 * {@link attributeLedger} once the step is over.
 */
export function summarizeTeamTurn(turn, { who, role, channel, threadId, sent, dm = false }) {
  return {
    sent,
    who,
    role,
    channel,
    dm,
    threadId: threadId ?? turn?.threadId ?? null,
    sessionId: turn?.sessionId ?? null,
    status: turn?.status ?? 'not-run',
    ok: turn?.ok ?? false,
    lastText: turn?.text ?? '',
    blocks: turn?.blocks ? turn.blocks.map((b) => b?.type ?? typeof b) : null,
    blockCount: turn?.blocks?.length ?? 0,
    asks: (turn?.asks ?? []).map((a) => ({
      text: String(a.message?.text ?? '').slice(0, 400),
      // The pod now NAMES the ask (`ChannelMessage.ask.id`) and dates it, and an answer can say
      // which ask it answered — so "did it park" stops being an inference from timing.
      askId: a.askId ?? a.message?.ask?.id ?? null,
      expiresAt: a.expiresAt ?? a.message?.ask?.expiresAt ?? null,
      answeredWith: a.answeredWith,
    })),
    answeredAsks: turn?.answered ?? 0,
    consumedPendingAsk: turn?.consumedPendingAsk ?? false,
    activity: turn?.activity ?? [],
    apps: turn?.apps ?? [],
    replyCount: turn?.replies?.length ?? 0,
    /** Machine vocabulary in what THING actually SAID to the channel — see `jargonHits`. */
    jargon: jargonHits(turn?.text),
    /** The id of the message this turn's `lastText` came from — so a reader can find it in the log. */
    replyId: turn?.reply?.id ?? null,
    /**
     * The pod's own cards about this turn ("<project> is ready.", posted by `announceNewApps` AFTER
     * the reply), kept SEPARATE from what THING said. Without them here, a step's evidence cannot
     * distinguish "THING answered 'user is ready.'" from "the pod pinned an app called user" — which
     * is exactly the misreading that produced a four-word answer for a nine-minute build.
     */
    systemCards: (turn?.systemCards ?? []).map((m) => ({ text: String(m.text ?? '').slice(0, 400), app: m.app ?? null })),
    durationMs: turn?.durationMs ?? 0,
    // Filled after the turn: from the session ledger when the pod recorded one, and from the
    // session's persisted statements when it did not (see `threadSessionFacts`).
    delegates: [],
    tokens: { in: 0, out: 0 },
    costUsd: 0,
    ledgerTracked: false,
  };
}

/**
 * Attach what the pod's own ledger says each turn's session did.
 *
 * This is the only route to "which specialist did it route to" for a channel turn: the session is
 * headless-threaded, so there is no `/events` stream, but `SessionManager` still tracks it in the
 * pod-global ledger with its delegates and token totals. Matching is by `sessionId`, which the reply
 * message carries — so a turn is attributed to its OWN work and not to a sibling's.
 */
export function attributeLedger(turns, ledgerSessions) {
  const bySession = new Map((ledgerSessions ?? []).map((s) => [s.sessionId, s]));
  for (const t of turns) {
    const rec = t.sessionId ? bySession.get(t.sessionId) : null;
    if (!rec) continue;
    t.ledgerTracked = true;
    t.delegates = (rec.delegates ?? []).map((d) => d.target);
    t.delegateDetail = (rec.delegates ?? []).map((d) => ({ target: d.target, status: d.status, depth: d.depth, ms: d.durationMs }));
    t.tokens = { in: rec.totalInputTokens ?? 0, out: rec.totalOutputTokens ?? 0 };
    t.costUsd = rec.totalCostUsd ?? 0;
    t.ledgerStatus = rec.status;
  }
  return turns;
}

/**
 * What a channel turn's session actually DID, recovered from the session snapshot on disk.
 *
 * Why this exists even though the pod now HAS a ledger for these turns: a channel turn is
 * headless-threaded, so it is never registered in the session manager and there is NO `/events`
 * endpoint to poll — the trace the personal runner asserts on does not exist for it. The pod-global
 * ledger (`GET /api/session-ledger`) does record it (`session-manager.ts:2161` —
 * `runHeadlessThreaded` calls `sessionLedger.trackTracer`, which is where tokens, cost and the
 * delegate tree come from), but the ledger records DELEGATE TARGETS, not which globals a turn
 * called. "Did it reach for `teamMembers`?" and "did it author anything?" are only answerable from
 * what the model WROTE.
 *
 * The session's persisted history is that record: `runHeadlessThreaded` writes
 * This is EVIDENCE, never an answer: the code is recorded for the judge to read, and is never
 * presented as what THING said (that is `lastText`, which comes from what it displayed).
 */
export function threadSessionFacts(dataDir, projectId, sessionId, { since = 0 } = {}) {
  if (!sessionId) return null;
  const file = join(dataDir, '.lmthing', projectId, 'sessions', sessionId, 'snapshot.json');
  let snap;
  try {
    snap = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const history = Array.isArray(snap.history) ? snap.history : [];
  const all = history
    .filter((h) => h && h.role === 'assistant' && typeof h.content === 'string')
    .map((h) => h.content);
  // ⚠️ A THREAD'S SNAPSHOT IS CUMULATIVE. Every turn in the thread resumes the SAME session and
  // rewrites the same file with the whole history, so reading it whole attributes turn 1's work to
  // turn 5 as well — 20-studio run 2 reported steps 7 and 8 (six and four seconds each) as having
  // delegated to system-appbuilder, which was step 6's seventeen-minute build. `since` is the
  // statement count the thread had BEFORE this turn, so each turn is credited only with its own.
  const written = all.slice(since);
  const code = written.join('\n');
  const delegates = new Set();
  // `delegate('space/agent', …)` and `delegate({ space: 'x', agent: 'y' })` are both in use.
  for (const m of code.matchAll(/delegate\s*\(\s*['"]([^'"]+)['"]/g)) delegates.add(m[1]);
  for (const m of code.matchAll(/delegate\s*\(\s*\{[^}]*?space\s*:\s*['"]([^'"]+)['"](?:[^}]*?agent\s*:\s*['"]([^'"]+)['"])?/gs)) {
    delegates.add([m[1], m[2]].filter(Boolean).join('/'));
  }
  const GLOBALS = [
    'writeProjectTable', 'writeProjectPage', 'writeProjectApi', 'writeProjectHook', 'writeProjectView',
    'writeProjectComponent', 'writeTableSchema', 'writeApi', 'writePage', 'writeHook', 'writeSpaceFile',
    'writeProjectFile', 'createProject', 'selectProject', 'installSpace', 'emitEvent', 'callConnection',
    'tasklist', 'fork', 'ask', 'display', 'remember', 'recall', 'webSearch', 'webFetch',
    // The TEAM workspace globals (`libs/core/src/eval/yield-router.ts:371-410`). These are the whole
    // reason a team pod can answer "who should I chase" or post into a channel it was not called
    // from — and a turn that never reaches for them, in a situation that calls for one, is a finding
    // about THING's instructions rather than about the globals.
    'teamContext', 'teamMembers', 'teamChannels', 'teamHistory', 'teamPost', 'teamPinApp',
  ];
  const globals = GLOBALS.filter((g) => new RegExp(`\\b${g}\\s*\\(`).test(code));
  const db = [...new Set([...code.matchAll(/\bdb\.(\w+)/g)].map((m) => `db.${m[1]}`))];
  return {
    sessionId,
    statements: written.length,
    /** How many statements the thread already had — this turn's work is everything after it. */
    since,
    totalStatements: all.length,
    delegates: [...delegates],
    // Every system space the code so much as names — a coarser signal than `delegates`, and the one
    // that still fires when the routing happened inside a tasklist rather than a direct call.
    spacesMentioned: [...new Set([...code.matchAll(/\bsystem-[a-z-]+/g)].map((m) => m[0]))],
    globals,
    db,
    codeChars: code.length,
    // The drill-down copy. Only ever read by a human or the judge, never shown as an answer.
    code: code.length > 20000 ? code.slice(0, 20000) + '\n… «truncated»' : code,
  };
}

/**
 * Every cron EMITTER DEF the run actually has, read off disk.
 *
 * A scenario cannot name these: the MODEL authors them mid-run, so `run_emitter: {scope, name}` in
 * the yaml is a SHAPE, not a promise (`campaign/scenario-spec.md` — "resolve the real value from the
 * live pod … a scenario file can only fix what's deterministic"). Firing the literal name would
 * either 404 or, worse, silently run nothing and let the step "pass".
 *
 * Defs live in `events/*.ts`, scoped to the project (`<project>/events/`) or to a space
 * (`<project>/spaces/<space>/events/`), and the run endpoint takes the pseudo-slug
 * `@emitter:<scope>:<name>` (`libs/cli/src/server/routes/hooks.ts:695`). A `type:'cron'` def is the
 * only kind a tick can force.
 */
export function scanEmitterDefs(dataDir, projectId) {
  const out = [];
  const root = join(dataDir, '.lmthing', projectId);
  const scan = (dir, scope) => {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f));
    } catch {
      return;
    }
    for (const f of files) {
      let src = '';
      try {
        src = readFileSync(join(dir, f), 'utf8');
      } catch {
        continue;
      }
      for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/g)) {
        const name = m[1];
        // The def's own body decides whether a tick can force it; `type: 'cron'` anywhere after the
        // declaration is a good-enough read of a file that usually holds one or two defs.
        const after = src.slice(m.index, m.index + 800);
        const type = /type\s*:\s*['"](\w+)['"]/.exec(after)?.[1] ?? 'unknown';
        out.push({ scope, name, type, file: join(dir, f), slug: `@emitter:${scope}:${name}` });
      }
    }
  };
  scan(join(root, 'events'), projectId);
  let spaces = [];
  try {
    spaces = readdirSync(join(root, 'spaces'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* no spaces */
  }
  for (const space of spaces) scan(join(root, 'spaces', space, 'events'), space);
  return out;
}

/**
 * Turn a scenario's placeholder `run_emitter` into the slug this run actually has.
 *
 * Exact name wins; then a case-insensitive token overlap ("morning_brief" finds `morningBrief`,
 * `daily-brief`, `briefPost`); then, if the run has exactly ONE cron def, that one — a scenario that
 * asks for "the scheduled thing" when the model built exactly one scheduled thing means that one.
 * Returns what it resolved AND everything it saw, so a step that fired the wrong emitter (or none)
 * is readable in the evidence rather than looking like the def simply did nothing.
 */
export function resolveEmitter(spec, defs, hooks = []) {
  const requested = typeof spec === 'string' ? { slug: spec } : spec.slug ? { slug: spec.slug } : { scope: spec.scope, name: spec.name };
  const candidates = defs.map((d) => ({ ...d }));
  const seen = { emitterDefs: candidates, hookSlugs: hooks.map((h) => h.slug) };
  if (requested.slug) return { requested, resolved: { slug: requested.slug }, how: 'literal', seen };

  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const tokens = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const wanted = norm(requested.name);

  const exact = candidates.find((d) => norm(d.name) === wanted && (!requested.scope || d.scope === requested.scope));
  if (exact) return { requested, resolved: exact, how: 'exact', seen };
  const anyScope = candidates.find((d) => norm(d.name) === wanted);
  if (anyScope) return { requested, resolved: anyScope, how: 'name-match-different-scope', seen };

  const want = tokens(requested.name);
  const scored = candidates
    .map((d) => ({ d, score: tokens(d.name).filter((t) => want.includes(t)).length + (want.some((t) => norm(d.name).includes(t)) ? 1 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length) return { requested, resolved: scored[0].d, how: `fuzzy(score ${scored[0].score})`, seen };

  const crons = candidates.filter((d) => d.type === 'cron');
  if (crons.length === 1) return { requested, resolved: crons[0], how: 'the run has exactly one cron def', seen };

  // A hook (not an emitter def) may be what the model authored instead — a plain `hooks/*.ts` cron.
  const hookMatch = hooks.find((h) => want.some((t) => norm(h.slug).includes(t)));
  if (hookMatch) return { requested, resolved: { slug: hookMatch.slug }, how: 'matched a plain hook slug', seen };

  return { requested, resolved: null, how: 'UNRESOLVED', seen };
}

/**
 * Words that name a part of the MACHINE, scanned in what THING says to a channel.
 *
 * Every team scenario's persona says the same thing: these people have never read a manual and will
 * never say space, project, agent, hook, table, deploy… The rule binds THING's replies too — a
 * journalist told her story now lives in "its own space", built by a "specialist", inside "the
 * Alcalá Post project" has been handed three words that mean nothing to her (21-newsroom run 1
 * step 4). Reported, never auto-failed: "the table by the window" is prose, and only a reader can
 * tell. The judge gets the word and the sentence it appeared in.
 */
const JARGON = [
  'space', 'spaces', 'project', 'projects', 'agent', 'agents', 'specialist', 'specialists',
  'hook', 'hooks', 'webhook', 'emitter', 'integration', 'install', 'installed', 'database',
  'schema', 'endpoint', 'endpoints', 'api', 'deploy', 'deployed', 'capability', 'consent',
  'delegate', 'delegated', 'tasklist', 'workflow', 'session', 'sessions', 'runtime', 'sandbox',
  // The personas ban these too ("they will never say … database, table, schema, row …"), and they
  // are the ones that actually reach a channel: "Bright Penny isn't in the boats TABLE yet"
  // (22-crossfire run 2 step 4). Kept in the same reported-never-auto-failed bucket, because a
  // boatyard legitimately has tables and rows of a different kind.
  'table', 'tables', 'row', 'rows', 'column', 'columns',
];

/** Machine words in one message, with the sentence each appeared in. */
export function jargonHits(text) {
  const out = [];
  const body = String(text ?? '');
  for (const word of JARGON) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    const m = re.exec(body);
    if (!m) continue;
    const start = Math.max(0, m.index - 60);
    out.push({ word, context: body.slice(start, m.index + word.length + 60).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** `compactStep` + the team fields. The personal `compactStep` is called unchanged, then the turn
 *  rows are re-projected with who/role/channel/thread so the judge can attribute every line. */
export function compactTeamStep(rec) {
  const base = compactStep(rec);
  base.turns = (rec.turns ?? []).map((t) => ({
    sent: typeof t.sent === 'string' && t.sent.length > 400 ? t.sent.slice(0, 400) + '…' : t.sent,
    who: t.who,
    role: t.role,
    channel: t.channel,
    dm: t.dm,
    threadId: t.threadId,
    sessionId: t.sessionId,
    status: t.status,
    lastText: typeof t.lastText === 'string' && t.lastText.length > 1200 ? t.lastText.slice(0, 1200) + '…' : t.lastText,
    blocks: t.blocks,
    delegates: t.delegates,
    wrote: t.wrote
      ? { statements: t.wrote.statements, delegates: t.wrote.delegates, spacesMentioned: t.wrote.spacesMentioned, globals: t.wrote.globals, db: t.wrote.db }
      : null,
    ledgerTracked: t.ledgerTracked,
    asks: t.asks,
    answeredAsks: t.answeredAsks,
    consumedPendingAsk: t.consumedPendingAsk,
    jargon: t.jargon,
    apps: t.apps,
    tokens: t.tokens,
    durationMs: t.durationMs,
  }));
  if (rec.team) base.team = rec.team;
  if (rec.denied) base.denied = rec.denied;
  if (rec.concurrent) base.concurrent = rec.concurrent;
  if (rec.channels) base.channels = rec.channels;
  if (rec.activeProject) base.activeProject = rec.activeProject;
  if (rec.crossChannelPosts) base.crossChannelPosts = rec.crossChannelPosts;
  // What the tick actually fired — the yaml can only carry a PLACEHOLDER name (the model authors
  // the real emitter mid-run), so "which slug ran, and what else existed" is the whole evidence for
  // a scheduled-turn step. `compactStep` knows nothing about it.
  if (rec.runEmitter) base.runEmitter = rec.runEmitter;
  if (rec.providerOutage) { base.providerOutage = rec.providerOutage; base.void = true; }
  if (rec.answeredParkedAsk !== undefined) base.answeredParkedAsk = rec.answeredParkedAsk;
  return base;
}

/** The human-readable trace for a team step: the personal lines, plus who/where on every turn. */
export function teamTraceLines(rec) {
  const L = [`\n## Step ${rec.step} — ${rec.verbs.join(', ')}${rec.concurrent ? ' (CONCURRENT)' : ''}`];
  for (const t of rec.turns ?? []) {
    L.push(`\n**${t.who}** <${t.role}> in ${t.dm ? `DM ${t.channel}` : `#${t.channel}`} · thread ${String(t.threadId).slice(0, 8)} · ${t.status}`);
    L.push(`- sent: ${String(t.sent).replace(/\n/g, ' ').slice(0, 200)}`);
    if (t.delegates?.length) L.push(`- delegates: ${t.delegates.join(', ')}`);
    if (t.wrote) {
      L.push(`- wrote ${t.wrote.statements} statement(s): ${t.wrote.globals.join(', ') || '(no known global)'}${t.wrote.db.length ? ` · ${t.wrote.db.join(', ')}` : ''}`);
      if (t.wrote.delegates.length) L.push(`  - delegated to: ${t.wrote.delegates.join(', ')}`);
      if (t.wrote.spacesMentioned.length) L.push(`  - spaces named in its code: ${t.wrote.spacesMentioned.join(', ')}`);
    }
    if (t.asks?.length) L.push(`- THING asked: ${t.asks.map((a) => `"${a.text.slice(0, 80)}" → ${a.answeredWith ? `"${a.answeredWith}"` : 'UNANSWERED (parked)'}`).join(' · ')}`);
    if (t.consumedPendingAsk) L.push('- this message ANSWERED the thread\'s parked question');
    if (t.apps?.length) L.push(`- apps announced: ${t.apps.map((a) => a.projectId ?? a).join(', ')}`);
    if (t.lastText) L.push(`- reply: ${String(t.lastText).replace(/\n/g, ' ').slice(0, 240)}`);
    L.push(`- tokens: ${t.tokens?.in ?? 0} in / ${t.tokens?.out ?? 0} out · ${(t.durationMs / 1000).toFixed(1)}s`);
  }
  if (rec.denied) L.push(`- ⛔ REFUSED by the pod: ${rec.denied.status} ${JSON.stringify(rec.denied.body).slice(0, 160)}`);
  if (rec.crossChannelPosts?.length) {
    L.push(`- THING posted into channels nobody asked it from: ${rec.crossChannelPosts.map((p) => `#${p.channelId} ("${String(p.text).slice(0, 60)}")`).join(', ')}`);
  }
  if (rec.channels) L.push(`- channels now: ${rec.channels.map((c) => `#${c.id}`).join(', ')}`);
  // Everything below is identical to the personal trace — reuse it rather than re-say it.
  const shared = traceLines({ ...rec, turns: [], verbs: rec.verbs, step: rec.step });
  L.push(...shared.slice(1));
  return L;
}

// ── the engine ──────────────────────────────────────────────────────────────────────────────────

export class TeamScenarioRunner {
  constructor({
    scenario,
    steps,
    scenarioDir,
    projectId,
    runId,
    resumeFrom = null,
    outDir,
    through,
    keepServer = false,
    purge = false,
    verbose = false,
    reporter = {},
  }) {
    this.scenario = scenario;
    this.steps = steps ?? [];
    this.scenarioDir = scenarioDir;
    this.projectId = projectId ?? scenario.project ?? scenario.id;
    this.runId = runId;
    this.resumeFrom = resumeFrom;
    this.outDir = outDir;
    this.through = through ?? this.steps.length;
    this.keepServer = keepServer;
    this.purge = purge;
    this.verbose = verbose;
    this.reporter = reporter ?? {};
    this.traceMd = [];
    /** step number → the ThreadSession(s) it opened, so `reply_to` continues the right conversation. */
    this.threads = new Map();
    /** every channel THING posted into that nobody addressed it from, per step. */
    this.knownChannelIds = new Set();
    /** Set once the run exists: the growing server log, as a liveness probe for a silent build. */
    this.liveness = null;
    /** sessionId → statements the thread had before the current turn (the snapshot is cumulative). */
    this.wroteMark = new Map();
    /** Steps whose failure was the PROVIDER's, not the product's — see `provider.mjs`. */
    this.voidSteps = [];
  }

  log(...a) {
    if (this.verbose) console.log('[run-team]', ...a);
  }

  /** The cast, as the TeamPod wants it: the yaml's `key` is the harness-local name. */
  castMembers() {
    return (this.scenario.cast ?? []).map((c) => ({
      name: c.key,
      userId: `u-${c.key}`,
      email: c.email ?? `${c.key}@team.test`,
      role: c.role ?? 'editor',
      handle: c.key,
      displayName: c.name ?? c.key,
    }));
  }

  /**
   * Create the declared categories and channels, and put every member in the directory.
   *
   * Done as the first EDITOR in the cast: creating a channel is configuring the team, which
   * team-guard refuses a viewer — so a scenario whose first member is a viewer would otherwise fail
   * to set itself up for a reason that is not the scenario's subject.
   */
  async provision(pod) {
    const editor = pod.members().find((m) => m.role === 'editor') ?? pod.members()[0];
    if (!editor) throw new FatalError('the scenario declares no cast');
    await pod.introduceAll();

    const categories = new Map();
    for (const c of this.scenario.channels ?? []) {
      if (!c.category || categories.has(c.category)) continue;
      const { category } = await pod.createCategory(editor, c.category);
      categories.set(c.category, category.id);
    }
    const made = [];
    for (const c of this.scenario.channels ?? []) {
      const { channel } = await pod.createChannel(editor, c.id, {
        ...(c.category ? { categoryId: categories.get(c.category) } : {}),
      });
      made.push(channel);
      this.knownChannelIds.add(channel.id);
    }
    return { editor, channels: made, categories: [...categories.keys()] };
  }

  /** The channel a (sub)step speaks in — a declared channel, or the DM between two members. */
  async channelFor(pod, sub) {
    if (sub.dm) {
      const { channel } = await pod.createDm(sub.as, sub.dm);
      this.knownChannelIds.add(channel.id);
      return { channelId: channel.id, dm: true };
    }
    return { channelId: sub.in, dm: false };
  }

  /**
   * The thread a (sub)step speaks into.
   *
   * `reply_to: N` continues the thread step N opened. When step N was CONCURRENT it opened several,
   * so the match narrows by speaker first (Sam replies to the thread Sam opened), then by channel —
   * which is what "reply to step 4" means when step 4 was two people talking at once.
   */
  threadFor(sub, { channelId, dm }, pod, opts = {}) {
    const target = sub.reply_to;
    if (target != null) {
      const candidates = this.threads.get(target) ?? [];
      const found =
        candidates.find((t) => t.openedBy === sub.as) ??
        candidates.find((t) => t.thread.channelId === channelId) ??
        candidates[0];
      if (!found) {
        throw new FatalError(`reply_to: ${target} — no thread was opened by step ${target} (it may have been refused, or never ran)`);
      }
      return found;
    }
    const thread = new ThreadSession(pod, {
      channelId,
      // The socket must be opened by somebody who may SEE the channel: a DM fans its events only to
      // its participants, so an outsider's socket receives nothing at all and the turn never lands.
      observeAs: sub.as,
      // A build emits no channel frames for minutes at a time, so "the socket has gone quiet" is not
      // "the turn has hung" — the run's own server log growing is. Without this the wait gives up
      // mid-build and reports a harness timeout as a product failure.
      ...(opts.liveness ? { liveness: opts.liveness } : {}),
      verbose: opts.verbose ?? false,
    });
    return { thread, openedBy: sub.as, dm };
  }

  /** Register a thread under the step that opened it, so a later `reply_to` finds it. */
  remember(num, entry) {
    const list = this.threads.get(num) ?? [];
    list.push(entry);
    this.threads.set(num, list);
  }

  /**
   * The `onAsk` for one step: answer a question THING parks in the thread from the step's
   * `if_asked` map, matching on a substring of the question exactly as `StepAsks` does for a chat
   * ask. An unmatched question is deliberately LEFT PARKED rather than answered with something
   * invented — the park is then recorded as evidence, which is the honest outcome.
   */
  askHandler(step) {
    const ifAsked = step.if_asked ?? {};
    const keys = Object.keys(ifAsked);
    return (message) => {
      const text = String(message?.text ?? '').toLowerCase();
      const matched = keys.find((k) => text.includes(k.toLowerCase().slice(0, 24))) ?? (keys.length === 1 ? keys[0] : undefined);
      if (!matched) {
        this.log(`if_asked: nothing matches "${text.slice(0, 80)}" — leaving the question parked`);
        return undefined;
      }
      return ifAsked[matched];
    };
  }

  /**
   * Everything a message needs BEFORE it can be sent: the channel (opening the DM if that is what
   * it is), the thread it belongs to, and a live socket watching that channel.
   *
   * Separate from sending because of `concurrent:` — the setup is I/O too (a socket upgrade), and
   * doing it inline would mean the second speaker's message left after the first speaker's turn had
   * already begun, which is not a race.
   */
  async prepare(pod, sub, step, num) {
    const member = pod.member(sub.as);
    let where = await this.channelFor(pod, sub);
    const entry = this.threadFor(sub, where, pod, { verbose: this.verbose, liveness: this.liveness });
    // A thread lives in ONE channel. If a `reply_to` step also names a different `in:`, the thread
    // wins — posting the reply into the named channel instead would silently open a new
    // conversation there and stop testing continuity, which is the whole point of `reply_to`.
    if (sub.reply_to != null && entry.thread.channelId !== where.channelId) {
      where = { channelId: entry.thread.channelId, dm: entry.dm ?? false };
    }
    await entry.thread.open();
    this.remember(num, entry);
    return {
      entry,
      member,
      where,
      opts: { onAsk: this.askHandler(step) },
      isReply: sub.reply_to != null,
      meta: { who: sub.as, role: member.role, channel: where.channelId, dm: where.dm, sent: sub.say },
    };
  }

  /**
   * Put one message on the wire. Returns the promise of the POST — the caller decides when to await
   * it, which is what lets `concurrent:` dispatch every message before waiting for any.
   *
   * The post is RAW: a refused write is a result the scenario asserts on (a viewer configuring the
   * team), not an exception that ends the run.
   */
  dispatch(pod, sub, prepared) {
    const { entry, isReply } = prepared;
    return pod.request(
      sub.as,
      'POST',
      `/api/team/channels/${prepared.where.channelId}/messages`,
      { text: sub.say, ...(isReply ? { threadId: entry.thread.threadId } : {}) },
      { raw: true },
    );
  }

  /** Fold a dispatched post into the record; returns what `awaitTurn` needs, or null if refused. */
  settleDispatch(raw, sub, prepared, rec) {
    const { entry, member, where, meta, isReply } = prepared;
    if (raw.status !== 201) {
      rec.denied = { who: sub.as, role: member.role, channel: where.channelId, status: raw.status, body: compact(raw.body) };
      rec.notes.push(`the pod REFUSED ${sub.as}<${member.role}> with ${raw.status} — recorded as evidence, not thrown`);
      rec.turns.push({ ...summarizeTeamTurn(null, meta), status: `refused-${raw.status}` });
      return null;
    }
    const sent = raw.body.message;
    if (!isReply) entry.thread.threadId = sent.threadId ?? sent.id;
    const consumed = entry.thread.parked;
    entry.thread.parked = false;
    return { sent, consumed };
  }

  /** Play one conversational step end to end. Returns the turn, or null when the pod refused. */
  async playMessage(pod, sub, step, rec, num) {
    const prepared = await this.prepare(pod, sub, step, num);
    const settled = this.settleDispatch(await this.dispatch(pod, sub, prepared), sub, prepared, rec);
    if (!settled) return null;
    const turn = await prepared.entry.thread.awaitTurn(sub.as, settled.sent, prepared.opts);
    turn.consumedPendingAsk = settled.consumed;
    rec.turns.push(summarizeTeamTurn(turn, { ...prepared.meta, threadId: turn.threadId }));
    return turn;
  }

  /** Play the scenario; returns { runId, ranSteps, ofSteps, outDir, results, summary }. */
  async run() {
    const { scenario, steps, scenarioDir, through } = this;
    reapOrphanRuns(scenarioDir);

    const problems = validateTeamScenario({ scenario, steps });
    if (problems.length) throw new FatalError(`scenario ${scenario.id} is not playable:\n  - ${problems.join('\n  - ')}`);

    let seedFrom = null;
    let startIndex = 0;
    let activeProject = 'user';
    if (this.resumeFrom) {
      const src = readRunJson(scenarioDir, this.resumeFrom.runId);
      activeProject = src.projectId ?? 'user';
      const fromStep = this.resumeFrom.from ?? src.completedSteps ?? 0;
      if (fromStep >= 1) {
        seedFrom = snapshotDir(scenarioDir, this.resumeFrom.runId, fromStep);
        if (!existsSync(seedFrom)) throw new FatalError(`no snapshot at ${seedFrom} — run ${this.resumeFrom.runId} did not complete step ${fromStep}`);
        startIndex = fromStep;
      }
    }

    // A run is hours of real model work. If the provider is already down, every turn will fail
    // identically and the evidence will look like a product collapse — so refuse to start instead.
    const provider = await checkProvider();
    this.reporter.onProvider?.(provider);
    if (!provider.ok) {
      throw new FatalError(
        `the model provider is unreachable — not starting a run that would record an outage as a product failure:\n  ` +
          provider.hosts.map((h) => `${h.host}:${h.port} — ${h.ok ? `ok (${h.ms}ms)` : h.error}`).join('\n  '),
      );
    }

    const runId = this.runId ?? nextRunId(scenarioDir);
    // The one server-side difference a team scenario needs. The `.team/` directory (channels,
    // members, the thread→session map) lives inside `.lmthing`, so it rides along in every snapshot
    // and a `--resume` restores the conversation as well as the project.
    const run = await startRun({
      scenarioDir,
      runId,
      projectId: activeProject,
      scenarioId: scenario.id,
      seedFrom,
      teamMode: true,
      teamId: scenario.team.id,
    });
    this.reporter.onRunStart?.({ runId, runDir: run.dir, port: run.port, base: run.base, seedFrom, teamId: scenario.team.id });

    // "The pod is still working" for a turn that emits no channel frames — see `threadFor`.
    this.liveness = () => { try { return statSync(run.logFile).size; } catch { return 0; } };

    const outDir = this.outDir ?? run.dir;
    mkdirSync(outDir, { recursive: true });
    const pidFile = join(outDir, 'runner.pid');
    writeFileSync(pidFile, String(process.pid));
    this.reporter.onPid?.({ pid: process.pid, pidFile });

    const killServer = () => { try { stopRun(run); } catch { /* already gone */ } };
    const onExit = () => { if (!this.keepServer) killServer(); try { rmSync(pidFile, { force: true }); } catch { /* ignore */ } };
    const onSignal = (code) => () => { killServer(); process.exit(code); };
    const sigHandlers = { SIGINT: onSignal(130), SIGTERM: onSignal(143), SIGHUP: onSignal(129), SIGQUIT: onSignal(131) };
    process.on('exit', onExit);
    for (const [sig, h] of Object.entries(sigHandlers)) process.on(sig, h);

    for (const f of readdirSyncSafe(outDir)) {
      if (/^step-\d+(\.full)?\.json$/.test(f) || f === 'summary.json' || f === 'trace.md') {
        try { rmSync(join(outDir, f), { force: true }); } catch { /* ignore */ }
      }
    }

    const results = [];
    const pod = new TeamPod({ base: run.base, teamId: scenario.team.id, members: this.castMembers(), verbose: false });
    let readPod; // a member-identified Pod for every non-channel read (a team pod 401s a nameless GET)
    try {
      const setup = await this.provision(pod);
      readPod = pod.podAs(setup.editor);
      this.log(`team ${scenario.team.id} · cast ${pod.members().map((m) => `${m.name}<${m.role}>`).join(', ')} · channels ${setup.channels.map((c) => c.id).join(', ')}`);
      this.reporter.onProvisioned?.({ cast: pod.members(), channels: setup.channels });

      for (let n = startIndex; n < Math.min(through, steps.length); n++) {
        const step = steps[n];
        const num = n + 1;
        const rec = {
          step: num,
          verbs: Object.keys(step).filter((k) => k !== 'expect'),
          expect: step.expect ?? [],
          team: scenario.team.id,
          turns: [],
          asks: [],
          notes: [],
        };
        this.log(`── step ${num}: ${rec.verbs.join(', ')}`);
        this.reporter.onStepStart?.({ step: num, verbs: rec.verbs, of: Math.min(through, steps.length) });

        const t0 = Date.now();
        const logMark = logSize(run.logFile);
        const ledgerBefore = await this.ledgerIds(readPod);
        const channelsBefore = await this.channelSnapshot(pod, setup.editor);
        try {
          activeProject = await this.runTeamStep({ step, num, pod, readPod, run, rec, activeProject, setup, channelsBefore });
        } catch (e) {
          rec.error = String(e?.stack ?? e?.message ?? e);
          rec.notes.push(`STEP THREW: ${rec.error.split('\n')[0]}`);
        }

        // ── did the PROVIDER fail, rather than the product? ─────────────────────────────────────
        // A turn that "gave up after its final retry" is only a finding when the pod was actually
        // talking to a model. Read the step's own slice of the server log before judging it.
        const failed = rec.error || rec.turns.some((t) => t.status === 'error' || t.status === 'timeout');
        if (failed) {
          const outage = providerOutageInLog(run.logFile, logMark);
          if (outage) {
            rec.providerOutage = outage;
            rec.void = true;
            rec.notes.push(
              `VOID — the model provider was unreachable during this step (${outage.signature}). This step tests nothing; do not file it as a defect.`,
            );
            this.voidSteps.push(num);
          }
        }

        // ── evidence ────────────────────────────────────────────────────────────────────────────
        const ledger = await this.ledger(readPod);
        attributeLedger(rec.turns, ledger);
        rec.newSessions = ledger.filter((s) => !ledgerBefore.has(s.sessionId)).length;
        // A channel turn is not in the ledger (see `threadSessionFacts`), so recover what it did
        // from the statements it wrote. Threaded sessions persist under the DEFAULT project, which
        // is where `routes/team-channels.ts` runs them — not under the project THING then created.
        for (const t of rec.turns) {
          if (t.inApp) continue;
          // Credit this turn with ONLY the statements it added — the snapshot is cumulative per
          // thread (see `threadSessionFacts`), and `this.wroteMark` holds the count before the turn.
          const since = t.sessionId ? (this.wroteMark.get(t.sessionId) ?? 0) : 0;
          t.wrote =
            threadSessionFacts(run.dataDir, 'user', t.sessionId, { since }) ??
            threadSessionFacts(run.dataDir, activeProject, t.sessionId, { since });
          if (t.sessionId && t.wrote) this.wroteMark.set(t.sessionId, t.wrote.totalStatements);
        }
        if (rec.turns.some((t) => !t.inApp && t.sessionId && !t.ledgerTracked)) {
          rec.notes.push(
            'a channel turn has no session-ledger record — its tokens/cost are unknown (the globals and delegates below still come from the session snapshot)',
          );
        }
        rec.channels = await this.channelSnapshot(pod, setup.editor);
        // A channel that gained THING messages this step but was not addressed in it is THING acting
        // across channels — 20-studio step 5's whole subject, and invisible in a per-thread view.
        rec.crossChannelPosts = await this.crossChannelPosts(pod, setup.editor, channelsBefore, rec);
        rec.activeProject = activeProject;
        rec.state = await snapshot(readPod, activeProject, { projectRoot: join(run.dataDir, '.lmthing', activeProject) });
        rec.snapshot = snapshotProject(run, num);
        rec.durationMs = Date.now() - t0;
        bumpCompletedSteps(run, num, { stepCount: steps.length, projectId: activeProject });
        this.reporter.onSnapshot?.({ step: num, dir: rec.snapshot });

        results.push(rec);
        const stem = join(outDir, `step-${String(num).padStart(2, '0')}`);
        writeFileSync(`${stem}.full.json`, JSON.stringify(rec, null, 2));
        writeFileSync(`${stem}.json`, JSON.stringify(compactTeamStep(rec), null, 2));
        this.traceMd.push(...teamTraceLines(rec));
        this.reporter.onStepDone?.({ step: num, rec });
      }
    } finally {
      for (const list of this.threads.values()) for (const e of list) { try { e.thread.close(); } catch { /* ignore */ } }
      try { pod.closeSockets(); } catch { /* ignore */ }
      if (!this.keepServer) killServer();
      try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
      process.removeListener('exit', onExit);
      for (const [sig, h] of Object.entries(sigHandlers)) process.removeListener(sig, h);
    }

    const summary = {
      scenario: scenario.id,
      team: scenario.team.id,
      run: runId,
      project: activeProject,
      cast: pod.members().map((m) => ({ key: m.name, role: m.role })),
      ranSteps: results.length,
      ofSteps: steps.length,
      startedAtStep: startIndex + 1,
      turns: results.reduce((a, r) => a + r.turns.length, 0),
      // Only the turns the pod actually accounted for. A channel turn is not one of them — see
      // `threadSessionFacts` — so this deliberately reports COVERAGE alongside the total rather
      // than a confident "0 in / 0 out" for work that demonstrably burned tokens.
      tokens: results.reduce(
        (a, r) => ({
          in: a.in + r.turns.reduce((x, t) => x + (t.tokens?.in ?? 0), 0),
          out: a.out + r.turns.reduce((x, t) => x + (t.tokens?.out ?? 0), 0),
        }),
        { in: 0, out: 0 },
      ),
      // Coverage, not just a total: a turn the pod did not account for must not read as "0 tokens".
      tokenAccounting: {
        turnsWithLedgerRecord: results.reduce((a, r) => a + r.turns.filter((t) => t.ledgerTracked).length, 0),
        turnsWithout: results.reduce((a, r) => a + r.turns.filter((t) => !t.ledgerTracked).length, 0),
        source: 'GET /api/session-ledger, matched by the reply message sessionId (runHeadlessThreaded registers it at session-manager.ts:2161)',
      },
      outDir,
      runDir: run.dir,
      finishedAt: new Date().toISOString(),
      // A run with void steps is not a result. Say so at the top level, where a judge reads first.
      ...(this.voidSteps.length
        ? { voidSteps: this.voidSteps, verdict: `VOID — ${this.voidSteps.length} step(s) failed because the model provider was unreachable` }
        : {}),
    };
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const tracePath = join(outDir, 'trace.md');
    writeFileSync(tracePath, this.traceMd.join('\n'));
    if (this.purge) { try { rmSync(run.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    this.reporter.onDone?.({ runId, ranSteps: results.length, ofSteps: steps.length, outDir, runDir: run.dir, tracePath, summary });
    return { runId, ranSteps: results.length, ofSteps: steps.length, outDir, results, summary };
  }

  // ── per-step verb dispatch ────────────────────────────────────────────────────────────────────
  async runTeamStep({ step, num, pod, readPod, run, rec, activeProject, setup, channelsBefore = [] }) {
    if (step.restart_pod) {
      rec.notes.push('restarting the team pod…');
      await restartRun(run);
      // Every watching socket died with the process; a thread that is replied to after this must
      // reconnect or its turn is awaited on a socket nobody is writing to.
      for (const list of this.threads.values()) for (const e of list) { try { e.thread.close(); } catch { /* ignore */ } }
      rec.notes.push('server back up; channel sockets will reconnect on demand');
    }

    // `attach_desktop:` — try to attach a desktop host bridge, and record what the pod said.
    //
    // A team pod must REFUSE this, before any role check, so that no agent in a shared channel has
    // a path to one member's laptop (`libs/cli/src/server/team-guard.ts`). The verb exists so that
    // refusal is asserted against a running pod rather than trusted from a unit test — this is the
    // one property whose failure mode is a security hole rather than a broken feature.
    if (step.attach_desktop) {
      const { probeHostBridge } = await import('../harness/lib/desktop-bridge.mjs');
      const outcome = await probeHostBridge({ base: pod.base, token: 'team-scenario' });
      rec.desktopBridge = outcome;
      if (outcome.accepted) {
        // Not a failed expectation to be scored later: a team pod that ACCEPTS a desktop bridge is
        // a hole, and the run stops rather than going on to ask an agent to use it.
        rec.notes.push('⚠️ the team pod ACCEPTED a desktop bridge — this must never happen');
        throw new FatalError(
          'a team pod accepted a desktop host bridge; team-guard.ts is not refusing /api/host/ws',
        );
      }
      // A refusal must be the POD's, with a status. No status means the pod was unreachable, and
      // scoring that as "refused" would report the boundary as holding without having touched it.
      if (outcome.status === null) {
        throw new FatalError(
          `could not reach the team pod's /api/host/ws to prove it refuses a desktop: ${outcome.reason}`,
        );
      }
      rec.notes.push(`desktop bridge refused with HTTP ${outcome.status}: ${outcome.reason}`);
    }

    if (step.concurrent) {
      rec.concurrent = step.concurrent.length;
      const subs = step.concurrent.map((s) => ({ ...s, reply_to: s.reply_to ?? step.reply_to }));
      // THE point of the verb, in three phases. Setting up a message is itself I/O (a DM to create,
      // a socket to upgrade), so ALL of it happens first; then every POST is put on the wire with no
      // await between them; only then does anything wait. Played in sequence this is a different
      // test entirely — the second speaker would arrive after the first speaker's turn had finished.
      const prepared = [];
      for (const sub of subs) prepared.push(await this.prepare(pod, sub, { ...step, if_asked: sub.if_asked ?? step.if_asked }, num));
      const posts = subs.map((sub, i) => this.dispatch(pod, sub, prepared[i]));
      rec.notes.push(`dispatched ${posts.length} messages in the same instant (${subs.map((s) => `${s.as}→${s.dm ? `DM ${s.dm}` : `#${s.in}`}`).join(', ')})`);
      const raws = await Promise.all(posts);
      const settled = raws.map((raw, i) => this.settleDispatch(raw, subs[i], prepared[i], rec));
      const turns = await Promise.all(
        settled.map(async (s, i) => {
          if (!s) return null; // refused — already recorded
          const turn = await prepared[i].entry.thread.awaitTurn(subs[i].as, s.sent, prepared[i].opts);
          turn.consumedPendingAsk = s.consumed;
          return { turn, meta: prepared[i].meta };
        }),
      );
      for (const t of turns) {
        if (!t) continue;
        rec.turns.push(summarizeTeamTurn(t.turn, { ...t.meta, threadId: t.turn.threadId }));
      }
    } else if (step.say != null && step.as) {
      await this.playMessage(pod, step, step, rec, num);
      if (step.answer_ask) {
        const last = rec.turns[rec.turns.length - 1];
        rec.answeredParkedAsk = last?.consumedPendingAsk ?? false;
        if (!rec.answeredParkedAsk) {
          rec.notes.push('answer_ask: the thread was NOT parked on a question — this message started a new turn instead of answering one');
        }
      }
    }

    // THING starts every channel turn in `user` and creates its own project if it builds one (the
    // `bootstrap: thing` shape). Rebind BEFORE the app verbs below, so `open_app` and the in-app
    // chat in the SAME step target the project the conversation just produced.
    if (activeProject === 'user') {
      const projs = (await readPod.listProjects().catch(() => ({ projects: [] }))).projects ?? [];
      const found = projs.map((p) => p.id ?? p).find((id) => id !== 'system' && id !== 'user');
      if (found) {
        rec.notes.push(`THING created project "${found}" — rebinding the evidence snapshot into it`);
        rec.createdProject = found;
        activeProject = found;
      }
    }

    if (step.in_app_chat != null) {
      // The in-app chat is a REAL session in the project (`POST /api/sessions`), reached as a member
      // — team-guard allows it to everyone, including a viewer, but not to a nameless caller.
      const who = step.as ?? setup.editor.name;
      const chatPod = pod.podAs(who);
      const session = new ThingSession(chatPod, { projectId: activeProject, verbose: this.verbose });
      await session.start();
      const turn = await session.send(step.in_app_chat);
      rec.turns.push({
        ...summarizeTeamTurn(null, { who, role: pod.member(who).role, channel: '(in-app)', sent: `[in-app] ${step.in_app_chat}` }),
        status: 'done',
        ok: true,
        sessionId: session.sessionId,
        lastText: turn.lastText,
        delegates: turn.delegates,
        tokens: turn.tokens,
        durationMs: turn.durationMs,
        inApp: true,
      });
    }

    if (step.open_app) {
      const build = await readPod.appBuild(activeProject).catch((e) => ({ error: String(e?.message ?? e) }));
      rec.appBuild = { built: build?.built ?? build?.build?.built ?? null, routes: build?.routes ?? null, error: build?.error ?? null };
      const check = await readPod.appCheck(activeProject).catch((e) => ({ error: String(e?.message ?? e) }));
      rec.appCheck = {
        ok: check?.ok ?? null,
        errorCount: Array.isArray(check?.errors) ? check.errors.length : null,
        errors: Array.isArray(check?.errors) ? check.errors.slice(0, 10) : null,
        error: check?.error ?? null,
      };
      const page = await readPod.appPage(activeProject).catch((e) => ({ error: String(e?.message ?? e) }));
      rec.appPageStatus = page?.status ?? (page?.error ? `error: ${page.error}` : 'ok');
      rec.notes.push('opened app (built + checked + fetched the root page)');
    }

    if (step.run_emitter) {
      // The yaml's emitter name is a PLACEHOLDER — the model authored the real one earlier in this
      // same run. Resolve it against what the pod actually has before firing anything.
      const defs = scanEmitterDefs(run.dataDir, activeProject);
      const hooks = (await readPod.listHooks().catch(() => ({ hooks: [] }))).hooks ?? [];
      const resolution = resolveEmitter(step.run_emitter, defs, hooks.filter((h) => h.projectId === activeProject));
      rec.runEmitter = {
        requested: resolution.requested,
        resolved: resolution.resolved,
        how: resolution.how,
        // Everything the run HAS, so an unresolved step is readable as "the model authored these
        // instead" rather than as a silent no-op.
        available: resolution.seen,
      };
      if (!resolution.resolved) {
        rec.notes.push(
          `run_emitter: nothing matches ${JSON.stringify(resolution.requested)} — the run has ${defs.length} emitter def(s): ${defs.map((d) => d.slug).join(', ') || '(none)'}`,
        );
      } else {
        const slug = resolution.resolved.slug ?? `@emitter:${resolution.resolved.scope}:${resolution.resolved.name}`;
        rec.notes.push(`run_emitter: fired ${slug} (${resolution.how})`);
        const result = await readPod
          .runHook(activeProject, slug, step.run_emitter.payload ?? {})
          .catch((e) => ({ error: String(e?.message ?? e) }));
        rec.runEmitter.slug = slug;
        rec.runEmitter.result = compact(result);
      }
      // Nothing was fired, so there is nothing to wait for — waiting the full budget here would
      // burn fifteen minutes proving that an emitter that was never run posted nothing.
      if (!resolution.resolved) return activeProject;

      // A scheduled turn's whole point is that it POSTS somewhere, out of band, while nobody is
      // typing. The tick returns as soon as the dispatch is QUEUED — the agent then reads state,
      // reasons and writes, which takes as long as it takes. So WAIT for the post rather than
      // sleeping a guessed interval: a fixed sleep either wastes minutes or, worse, ends the step
      // before the brief lands and records "it posted nothing" for a feature that works.
      const waited = await this.waitForAnyPost(pod, setup.editor, channelsBefore, {
        timeoutMs: Number(process.env.SCENARIO_EMITTER_WAIT_MS || 900_000),
      });
      rec.runEmitter.postedAfterMs = waited.ms;
      rec.notes.push(
        waited.posted
          ? `the tick produced a post in #${waited.channelId} after ${(waited.ms / 1000).toFixed(0)}s`
          : `NOTHING was posted in any channel within ${(waited.ms / 1000).toFixed(0)}s of the tick`,
      );
    }

    return activeProject;
  }

  // ── evidence helpers ──────────────────────────────────────────────────────────────────────────
  async ledger(readPod) {
    const l = await readPod.sessionLedger().catch(() => ({ sessions: [] }));
    return l.sessions ?? [];
  }

  async ledgerIds(readPod) {
    return new Set((await this.ledger(readPod)).map((s) => s.sessionId));
  }

  /**
   * Wait until any channel gains a message, or the budget runs out.
   *
   * The completion signal for a SCHEDULED turn. Nobody is in a thread to watch over the socket (the
   * tick is not a reply to anyone), and the run endpoint answers as soon as the dispatch is queued —
   * so the only honest "it happened" is the message appearing in the log.
   */
  async waitForAnyPost(pod, who, before, { timeoutMs = 900_000, pollMs = 5_000 } = {}) {
    const beforeById = new Map((before ?? []).map((c) => [c.id, c.count]));
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const now = await this.channelSnapshot(pod, who);
      const grew = now.find((c) => c.count > (beforeById.get(c.id) ?? 0));
      if (grew) return { posted: true, channelId: grew.id, ms: Date.now() - t0 };
      await sleep(pollMs);
    }
    return { posted: false, channelId: null, ms: Date.now() - t0 };
  }

  /** Every channel with its message count — the cheap before/after a cross-channel post shows up in. */
  async channelSnapshot(pod, who) {
    const { channels } = await pod.listChannels(who).catch(() => ({ channels: [] }));
    const out = [];
    for (const c of channels ?? []) {
      const { messages } = await pod.listMessages(who, c.id, { limit: 200 }).catch(() => ({ messages: [] }));
      out.push({ id: c.id, name: c.name, kind: c.kind ?? 'channel', count: (messages ?? []).length, lastTs: messages?.at(-1)?.ts ?? null });
    }
    return out;
  }

  /**
   * THING messages that appeared in a channel this step did not speak in.
   *
   * "It posts into #studio, a channel it was NOT called from" (20-studio step 5) and "the brief is
   * POSTED INTO #newsroom" (21-newsroom step 5) are both invisible to a per-thread reader: the turn
   * that produced them answered somewhere else entirely. So diff the channel message counts across
   * the step and record the actual messages THING left behind.
   */
  async crossChannelPosts(pod, who, before, rec) {
    const spokenIn = new Set((rec.turns ?? []).map((t) => t.channel));
    const beforeById = new Map((before ?? []).map((c) => [c.id, c.count]));
    const after = await this.channelSnapshot(pod, who);
    const out = [];
    for (const c of after) {
      const gained = c.count - (beforeById.get(c.id) ?? 0);
      if (gained <= 0 || spokenIn.has(c.id)) continue;
      const { messages } = await pod.listMessages(who, c.id, { limit: 50 }).catch(() => ({ messages: [] }));
      for (const m of (messages ?? []).slice(-gained)) {
        if (m.kind === 'user') continue;
        out.push({ channelId: c.id, kind: m.kind, text: String(m.text ?? '').slice(0, 400), threadId: m.threadId ?? null, sessionId: m.sessionId ?? null });
      }
    }
    return out;
  }
}

/** Convenience: `new TeamScenarioRunner(cfg).run()`. */
export function runTeamScenario(cfg) {
  return new TeamScenarioRunner(cfg).run();
}
