Sometimes the broken thing is not app code but a **space** — a bundle of AI specialists. A project
can ship its own under `<projectId>/spaces/<name>/`.

```
<space>/
├── agents/<slug>/
│   ├── charter.md          identity/guardrails (body only, no frontmatter)
│   └── instruct.md         YAML frontmatter (config) + operating instructions
├── functions/<fn>.ts       deterministic TS helpers — no model in the loop
├── components/{view,form}/<Name>.tsx
├── tasklists/<slug>/       index.md + NN-<id>.md DAG steps
├── knowledge/<domain>/<field>/   index.md + one .md per aspect
├── events/<name>.ts        typed emitter defs
└── hooks/<slug>.ts         event consumers
```

## Why a space fails to load — and it is all-or-nothing

Space loading is **fail-loud and total**: one bad reference aborts the entire space, so every agent
in it disappears at once. That is why the symptom is usually "the agent is not found" rather than
anything resembling the actual mistake.

The load-time checks, each of which throws:

- **A disallowed frontmatter key.** The allow-list is exactly `title`, `knowledge`, `functions`,
  `components`, `actions`, `defaultAction`, `canDelegateTo`, `dependencies`, `capabilities`,
  `model`, `triggers`. Anything else — including a near-miss like `capabilties` — aborts the load.
  This is deliberate: a typo that silently granted nothing would be far worse.
- **A `functions:` entry with no matching file** in the space's `functions/` directory.
- **A `components:` entry** present in neither `components/view/` nor `components/form/`.
- **A `knowledge:` ref** whose `<domain>/<field>[/<option>]` does not resolve in the `knowledge/`
  tree.
- **An `actions[].tasklist`** naming a tasklist directory that does not exist.

When an agent "is not found", read its whole `instruct.md` frontmatter against that list before
anything else. The error is almost always one line of YAML.

## Silent failures that do not throw

- **A knowledge load point with no file.** A misspelled aspect name does not fail typecheck and does
  not fail the load — the content simply never arrives, and the agent behaves as if that guidance
  was never written.
- **An orphaned aspect.** A `.md` nothing references is dead weight; it costs nothing at runtime but
  it is also doing nothing.
- **An empty placeholder agent directory.** An `agents/<slug>/` with no `instruct.md` will not
  shadow a real system agent of the same slug — the loader guards that case specifically — but it
  is still not the agent anyone meant to write.

## What a space function is

Plain TypeScript under `functions/`; the export name is the file's basename. There is no
frontmatter and **no model in the loop** — the source is injected into the agent's sandbox VM and
called as ordinary code. An agent can call one only if its `functions:` frontmatter names it.

They run inside a QuickJS sandbox: no filesystem, no `child_process`, no Node built-ins. A function
that needs to reach outside does it with `fetch`.

## Rule

Fix a space inside the **project** that owns it. `system/spaces/` is re-materialized from the
container image on every boot — a change there reports success and is gone after the next restart.
