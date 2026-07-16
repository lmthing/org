---
id: build_app
output:
  ok: boolean
  detail: string
dependsOn: [build_specialist]
goal: true
role: general
functions: []
canDelegateTo:
  - system-appbuilder/automator#build_live_project
---

Build the live-project app after every inventoried specialist has finished. `request`,
`sourceSummary`, `attachmentIds`, `specialistFacts`, and `build_specialist` are in scope. Delegate to
the live-project automator, which writes into this project's database and pages. Pass every attachment
id so it can read all supplied source files; include `specialistFacts` because image and audio facts
cannot be re-read. Mention any failed specialist build in the request, but still build from the
complete supplied source. The deliverable is not complete until it has source-derived rows and an
openable page backed by the project's own API; do not report a survey or data model as a finished
app. Emit exactly one self-contained statement that delegates and resolves without relying on a later
statement or cross-turn variable:

currentTask.resolve(await delegate('system-appbuilder', 'automator', 'build_live_project', { query: String(request) + '\n\nBuild the complete live-project app now: write source-derived tables and rows, then write the project API and openable pages that show those rows.\n\nSource summary:\n' + String(sourceSummary) + '\n\nFacts available only from image/audio analysis:\n' + String(specialistFacts) + '\n\nSpecialist build results:\n' + JSON.stringify(build_specialist), context: { attachmentIds: attachmentIds as string[] }, attachmentIds: attachmentIds as string[] }).then((app) => { const envelope = app as { ok?: boolean; data?: { ok?: boolean } }; return { ok: envelope.ok === true && envelope.data?.ok === true, detail: JSON.stringify(envelope.data ?? {}) }; }));