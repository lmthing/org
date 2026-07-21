---
id: build_app
output:
  ok: boolean
  detail: string
dependsOn: [assess, add_specialist]
goal: false
role: general
functions: []
canDelegateTo:
  - system-appbuilder/automator#build_live_project
---

Build the app part of the new area into the live project. `assess` (`topic`, `appRequest`,
`groundingFacts`), the original `request`, and `attachmentIds` are in scope. `add_specialist` is in
scope too, but may be absent (it only runs for a genuinely new area) — do not depend on it.

Delegate to the live-project automator so it authors the table(s) (seeding the grounding facts), the
page, and any reminder the user asked for, directly into THIS project. Hand the original `request`
verbatim plus `assess.appRequest`, and pass the SAME `attachmentIds` so the automator reads any
supplied file itself and seeds every row. Emit exactly one self-contained statement:

currentTask.resolve(await delegate('system-appbuilder', 'automator', 'build_live_project', { query: String(request) + '\n\nBuild this into the app IN this live project: ' + String(assess.appRequest) + ' Grounding facts: ' + String(assess.groundingFacts || ''), attachmentIds }).then((auto) => { const ok = !!(auto && (auto.ok === true || (auto.data && auto.data.ok === true))); return { ok, detail: ok ? ('built the app part for ' + String(assess.topic)) : ('the app build did not confirm for ' + String(assess.topic)) }; }));
