/**
 * Scenario report builder — turns a run into the "Actual results" table that gets pasted back
 * into the scenario's markdown file, so every run is reproducible and reviewable.
 *
 * A scenario is a list of steps; each step has an EXPECTED outcome declared up front and an
 * ACTUAL outcome recorded at run time. `check()` records a pass/fail against an expectation;
 * `note()` records an observation. Nothing throws by default — a scenario is meant to run to the
 * end and report every failure, not die on the first one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class Report {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.started = Date.now();
    this.steps = [];
    this.current = null;
    this.metrics = [];
    this.issues = [];
  }

  /** Begin a step. `expected` is the contract this step is asserting. */
  step(name, expected) {
    this.current = { name, expected, checks: [], notes: [], started: Date.now() };
    this.steps.push(this.current);
    console.log(`\n── ${this.id} · ${name}\n   expect: ${expected}`);
    return this.current;
  }

  check(label, pass, actual = '') {
    const rec = { label, pass: !!pass, actual: String(actual).slice(0, 500) };
    (this.current?.checks ?? (this.current = this.step('(unnamed)', '')).checks).push(rec);
    console.log(`   ${pass ? '✓' : '✗'} ${label}${actual ? ` — ${String(actual).slice(0, 160)}` : ''}`);
    return rec.pass;
  }

  note(text) {
    this.current?.notes.push(String(text));
    console.log(`   · ${text}`);
  }

  /** A row for the performance table (turn timings, token burn, event counts). */
  metric(name, value, unit = '') {
    this.metrics.push({ name, value, unit });
    console.log(`   ▸ ${name}: ${value}${unit}`);
  }

  /** A bug found during the run. `fix` is filled in once the subagent has fixed it. */
  issue(title, detail, { severity = 'bug', fix = null } = {}) {
    this.issues.push({ title, detail: String(detail).slice(0, 2000), severity, fix });
    console.log(`   ⚠ ISSUE [${severity}] ${title}`);
  }

  get passed() {
    return this.steps.every((s) => s.checks.every((c) => c.pass));
  }

  summary() {
    const all = this.steps.flatMap((s) => s.checks);
    return { total: all.length, passed: all.filter((c) => c.pass).length, issues: this.issues.length };
  }

  /** Render the "Actual results" markdown that gets appended to the scenario doc. */
  markdown() {
    const s = this.summary();
    const mins = ((Date.now() - this.started) / 60_000).toFixed(1);
    const L = [
      `## Actual results — run ${new Date(this.started).toISOString()}`,
      ``,
      `**Verdict: ${this.passed ? '✅ PASS' : '❌ FAIL'}** · ${s.passed}/${s.total} checks · ` +
        `${s.issues} issue(s) found · ${mins} min wall clock`,
      ``,
    ];
    for (const st of this.steps) {
      L.push(`### ${st.name}`, ``, `*Expected:* ${st.expected}`, ``);
      if (st.checks.length) {
        L.push(`| Check | Result | Actual |`, `|---|---|---|`);
        for (const c of st.checks) {
          const actual = c.actual.replace(/\|/g, '\\|').replace(/\n/g, ' ');
          L.push(`| ${c.label} | ${c.pass ? '✅' : '❌'} | ${actual || '—'} |`);
        }
        L.push('');
      }
      for (const n of st.notes) L.push(`> ${n.replace(/\n/g, '\n> ')}`, '');
    }
    if (this.metrics.length) {
      L.push(`### Performance`, ``, `| Metric | Value |`, `|---|---|`);
      for (const m of this.metrics) L.push(`| ${m.name} | ${m.value}${m.unit} |`);
      L.push('');
    }
    if (this.issues.length) {
      L.push(`### Issues found`, ``);
      for (const i of this.issues) {
        L.push(
          `#### ${i.severity}: ${i.title}`,
          ``,
          i.detail,
          ``,
          i.fix ? `**Fix:** ${i.fix}` : `**Fix:** _pending_`,
          ``,
        );
      }
    }
    return L.join('\n');
  }

  save(path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, this.markdown());
    console.log(`\n📄 ${path}  (${this.passed ? 'PASS' : 'FAIL'})`);
    return path;
  }

  /** Dump the raw trace for post-mortems — a scenario report is only as good as its evidence. */
  saveTrace(path, session) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ stats: session.stats(), events: session.events }, null, 2));
    return path;
  }
}
