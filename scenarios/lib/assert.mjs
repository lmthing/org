/**
 * assert.mjs — the MECHANICAL oracle for repro probes (the fast, targeted regression tier).
 *
 * A full scenario's `expect:` is PROSE an LLM judge scores. A repro's `assert:` is a small typed DSL
 * the harness evaluates DETERMINISTICALLY against the observables the runner already captures — the
 * per-step `rec.state` snapshot (spaces + app tables WITH rows + manifest) and the turn evidence
 * (reply, yield kinds, delegates) — plus a direct read of the run's on-disk space-knowledge files.
 * Each assert returns `{ pass, actual }`; a repro run PASSES only when EVERY assert passes. A FAILING
 * assert means the bug is present (the probe went RED) — which is exactly what a valid repro must do
 * on the buggy commit, and must STOP doing once the fix lands.
 *
 * Grammar (one assert per string; whitespace-tolerant, values may be "quoted" to include spaces):
 *   db <table> count <op> <n>                          # <op> ∈ == != >= <= > <
 *   db <table> where <col>=<val> exists | absent
 *   db <table> where <col>=<val> <field> empty | nonempty
 *   db <table> where <col>=<val> <field> == <v2>       # (or !=)
 *   knowledge <spaceSubstr|*> matches /<regex>/[i]     # some space-knowledge file body matches
 *   reply not_raw                                       # the final reply is not a raw data dump
 *   reply matches | not_matches /<regex>/[i]            # over the reply's RENDERED (flattened) text
 *   yield present | absent <kind>                       # a yield kind fired / didn't across the turns
 *
 * The evaluation context is `{ state, turns, dataDir, projectId }`:
 *   state    = rec.state          — { spaces:[], appTables:{table: rows[]}, appManifest, error, appError }
 *   turns    = rec.turns          — [{ lastText, yieldKinds:[], delegates:[], yields:[], errors:[] }]
 *   dataDir  = <runDir>/data      — for reading .lmthing/<project>/spaces/<space>/knowledge/**
 *   projectId= the seeded project
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── tokenizer: split on whitespace, but keep "quoted spans" as one token ────────────────────────
function tokenize(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line.trim()) {
    if (ch === '"') { q = !q; continue; }
    if (!q && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const looseEq = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';
function cmpNum(op, a, b) {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    default: return false;
  }
}

// ── observables ─────────────────────────────────────────────────────────────────────────────────
const rowsOf = (ctx, table) => {
  const v = ctx.state?.appTables?.[table];
  return Array.isArray(v) ? v : [];
};
const lastReplyRaw = (ctx) => {
  const t = (ctx.turns ?? []).map((x) => x.lastText).filter(Boolean);
  return t.length ? t[t.length - 1] : '';
};
const allYieldKinds = (ctx) => [...new Set((ctx.turns ?? []).flatMap((t) => t.yieldKinds ?? []))];

/** A reply is RAW when it is valid JSON that is NOT a rendered component node — an array, or an
 *  object with no string `type` (e.g. a `{ok,entries}` dir listing, a `{rows:[…]}` dump). A component
 *  AST (`{type:"Stack",children:…}`) has a string `type` and is NOT raw; plain prose/markdown that
 *  doesn't parse as JSON is NOT raw either. */
export function isRawReply(text) {
  if (typeof text !== 'string') return false;
  const s = text.trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return false;
  let v;
  try { v = JSON.parse(s); } catch { return false; }
  if (Array.isArray(v)) return true;
  return typeof v?.type !== 'string';
}

/** Flatten a component-AST reply (or return prose as-is) to plain text so `reply matches /…/` can
 *  test rendered content mechanically. */
export function flattenReply(text) {
  if (typeof text !== 'string') return String(text ?? '');
  const s = text.trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return text;
  let node;
  try { node = JSON.parse(s); } catch { return text; }
  const walk = (n) => {
    if (n == null) return '';
    if (typeof n === 'string') return n;
    if (Array.isArray(n)) return n.map(walk).join(' ');
    if (typeof n === 'object') {
      let out = '';
      const p = n.props ?? {};
      if (p.title) out += p.title + ' ';
      if (p.label) out += p.label + '=';
      if (p.value !== undefined) out += String(p.value) + ' ';
      if (p.pairs) out += Object.entries(p.pairs).map(([k, v]) => `${k}:${v}`).join(', ') + ' ';
      if (p.items) out += walk(p.items) + ' ';
      if (p.columns) out += walk(p.columns) + ' ';
      if (p.rows) out += n.props.rows.map(walk).join(' | ') + ' ';
      if (n.children) out += walk(n.children);
      return out;
    }
    return '';
  };
  return walk(node).replace(/\s+/g, ' ').trim();
}

function walkFiles(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out = out.concat(walkFiles(p));
    else out.push(p);
  }
  return out;
}

/** Every space-knowledge file body in the seeded project, optionally scoped to space dirs whose name
 *  includes `spaceSubstr` (`*` = all spaces). */
function knowledgeFiles(ctx, spaceSubstr) {
  const spacesDir = join(ctx.dataDir, '.lmthing', ctx.projectId ?? '', 'spaces');
  let spaceDirs;
  try { spaceDirs = readdirSync(spacesDir); } catch { return []; }
  const want = spaceSubstr && spaceSubstr !== '*' ? spaceSubstr.toLowerCase() : null;
  const files = [];
  for (const sp of spaceDirs) {
    if (want && !sp.toLowerCase().includes(want)) continue;
    for (const f of walkFiles(join(spacesDir, sp, 'knowledge'))) {
      if (!/\.(md|txt|json)$/i.test(f)) continue;
      try { files.push({ file: `${sp}/${f.slice(join(spacesDir, sp).length + 1)}`, content: readFileSync(f, 'utf8') }); } catch { /* skip */ }
    }
  }
  return files;
}

function reLit(m) { return new RegExp(m[1], m[2] || ''); }

// ── the evaluator ─────────────────────────────────────────────────────────────────────────────
/** Evaluate ONE assert line against the context. Returns `{ pass, actual }` (or `{ pass:false,
 *  actual, error }` when the line is malformed — a malformed assert never silently passes). */
export function evaluate(line, ctx) {
  const t = tokenize(line);
  try {
    // db …
    if (t[0] === 'db') {
      const table = t[1];
      const rows = rowsOf(ctx, table);
      if (t[2] === 'count') {
        const op = t[3];
        const n = Number(t[4]);
        return { pass: cmpNum(op, rows.length, n), actual: `${table}.count=${rows.length}` };
      }
      if (t[2] === 'where') {
        const eq = t[3].indexOf('=');
        const col = t[3].slice(0, eq);
        const val = t[3].slice(eq + 1);
        const matched = rows.filter((r) => looseEq(r?.[col], val));
        // db <table> where col=val exists|absent
        if (t[4] === 'exists') return { pass: matched.length > 0, actual: `${matched.length} row(s) ${col}=${val}` };
        if (t[4] === 'absent') return { pass: matched.length === 0, actual: `${matched.length} row(s) ${col}=${val}` };
        // db <table> where col=val <field> empty|nonempty
        const field = t[4];
        if (t[6] === undefined && (t[5] === 'empty' || t[5] === 'nonempty')) {
          if (matched.length === 0) return { pass: false, actual: `no row ${col}=${val}` };
          const allEmpty = matched.every((r) => isEmpty(r?.[field]));
          const allFull = matched.every((r) => !isEmpty(r?.[field]));
          const vals = matched.map((r) => JSON.stringify(r?.[field] ?? null)).join(',');
          return { pass: t[5] === 'empty' ? allEmpty : allFull, actual: `${field}=[${vals}]` };
        }
        // db <table> where col=val <field> ==|!= <v2>
        if (t[5] === '==' || t[5] === '!=') {
          if (matched.length === 0) return { pass: false, actual: `no row ${col}=${val}` };
          const v2 = t[6];
          const hit = matched.every((r) => (t[5] === '==' ? looseEq(r?.[field], v2) : !looseEq(r?.[field], v2)));
          const vals = matched.map((r) => JSON.stringify(r?.[field] ?? null)).join(',');
          return { pass: hit, actual: `${field}=[${vals}]` };
        }
      }
      return { pass: false, actual: line, error: 'unrecognized db assert' };
    }
    // knowledge <space|*> matches /re/[i]
    if (t[0] === 'knowledge') {
      const m = line.match(/^knowledge\s+(\S+)\s+matches\s+\/(.*)\/([a-z]*)\s*$/);
      if (!m) return { pass: false, actual: line, error: 'bad knowledge assert' };
      const re = reLit([null, m[2], m[3]]);
      const files = knowledgeFiles(ctx, m[1]);
      const hit = files.find((f) => re.test(f.content));
      return { pass: !!hit, actual: hit ? `matched ${hit.file}` : `no match in ${files.length} knowledge file(s)` };
    }
    // reply …
    if (t[0] === 'reply') {
      const reply = lastReplyRaw(ctx);
      if (t[1] === 'not_raw') {
        const raw = isRawReply(reply);
        return { pass: !raw, actual: raw ? `RAW: ${String(reply).slice(0, 120)}` : 'rendered/prose reply' };
      }
      const m = line.match(/^reply\s+(matches|not_matches)\s+\/(.*)\/([a-z]*)\s*$/);
      if (!m) return { pass: false, actual: line, error: 'bad reply assert' };
      const re = reLit([null, m[2], m[3]]);
      const text = flattenReply(reply);
      const found = re.test(text);
      return { pass: m[1] === 'matches' ? found : !found, actual: `${found ? 'found' : 'absent'} in reply` };
    }
    // yield present|absent <kind>
    if (t[0] === 'yield') {
      const kinds = allYieldKinds(ctx);
      const has = kinds.includes(t[2]);
      if (t[1] === 'present') return { pass: has, actual: `yields=[${kinds.join(',')}]` };
      if (t[1] === 'absent') return { pass: !has, actual: `yields=[${kinds.join(',')}]` };
    }
  } catch (e) {
    return { pass: false, actual: line, error: String(e?.message ?? e) };
  }
  return { pass: false, actual: line, error: 'unrecognized assert' };
}

/** Evaluate all asserts for one run; returns `{ green, results:[{line,pass,actual,error?}] }`.
 *  `green` = every assert passed (correct behavior); `!green` = the bug reproduced (RED). */
export function evaluateAll(asserts, ctx) {
  const results = (asserts ?? []).map((line) => ({ line, ...evaluate(line, ctx) }));
  return { green: results.every((r) => r.pass), results };
}
