---
id: finalize
output:
  ok: boolean
  added: array
  changed: array
  missing: array
  errors: array
dependsOn: [plan_change, implement_tables, implement_endpoints, implement_components, implement_views, verify]
goal: true
role: general
functions: []
---

Report HONESTLY — the GOAL task, which ALWAYS runs. Resolve `ok` true only when every implement
result landed AND `verify` found nothing wrong (`verify.ok`) — a single item that failed to land, or
a residual `verify` finding, means the app still has a problem and that must be surfaced, never
smoothed over.

Shape `missing`/`errors` in the SAME form `repair_live_project` accepts as input, so a caller with a
still-imperfect result can hand them straight to `repair_live_project({ missing, errors })` next —
cheap, since it only touches what is still wrong — rather than re-running this tasklist or
`build_live_project` blind. Emit one statement:

```typescript
const allImplemented = [
  ...(Array.isArray(implement_tables) ? implement_tables : []).map((r: { name: string; ok: boolean }) => ({ ...r, cat: 'table' as const })),
  ...(Array.isArray(implement_endpoints) ? implement_endpoints : []).map((r: { route: string; ok: boolean }) => ({ ...r, name: r.route, cat: 'endpoint' as const })),
  ...(Array.isArray(implement_components) ? implement_components : []).map((r: { name: string; ok: boolean }) => ({ ...r, cat: 'component' as const })),
  ...(Array.isArray(implement_views) ? implement_views : []).map((r: { route: string; ok: boolean }) => ({ ...r, name: r.route, cat: 'view' as const })),
];
const planned = [
  ...(Array.isArray(plan_change.tables) ? plan_change.tables : []).map((t: { name: string; existing: boolean }) => ({ name: t.name, existing: t.existing })),
  ...(Array.isArray(plan_change.endpoints) ? plan_change.endpoints : []).map((e: { route: string; existing: boolean }) => ({ name: e.route, existing: e.existing })),
  ...(Array.isArray(plan_change.components) ? plan_change.components : []).map((c: { name: string; existing: boolean }) => ({ name: c.name, existing: c.existing })),
  ...(Array.isArray(plan_change.views) ? plan_change.views : []).map((v: { route: string; existing: boolean }) => ({ name: v.route, existing: v.existing })),
];
const existingByName = new Map(planned.map((p) => [p.name, p.existing]));
const added = allImplemented.filter((r) => r.ok && existingByName.get(r.name) === false).map((r) => `${r.cat}:${r.name}`);
const changed = allImplemented.filter((r) => r.ok && existingByName.get(r.name) === true).map((r) => `${r.cat}:${r.name}`);
const notLanded = allImplemented.filter((r) => !r.ok);

const verifyResult = verify as { ok: boolean; offending: Array<{ path: string; kind: string; errors: Array<{ phase: string; message: string }> }>; toAuthor: Array<{ kind: string; name: string; hint: string }> };
const errors = verifyResult.offending.flatMap((o) => o.errors.map((e) => ({ file: o.path, phase: e.phase, message: e.message })));
const missing = verifyResult.toAuthor
  .filter((t) => t.kind === 'page' || t.kind === 'table' || t.kind === 'automation')
  .map((t) => t.kind === 'page' ? { kind: 'page', route: t.name, error: t.hint }
    : t.kind === 'table' ? { kind: 'table', name: t.name, error: t.hint }
    : { kind: 'automation', slug: t.name, error: t.hint });

currentTask.resolve({
  ok: verifyResult.ok && notLanded.length === 0,
  added,
  changed,
  missing,
  errors,
});
```
