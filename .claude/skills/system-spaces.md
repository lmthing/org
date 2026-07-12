---
name: system-spaces
description: Load when adding a system space, host primitive, or fork role, or when referencing the system-spaces catalog / host-injected VM globals.
---

# Skill: System spaces, host primitives, and fork roles

Load this when you are **adding or editing a bundled system space** (`sdk/org/libs/core/system-spaces/*`), adding a **function to the universal toolkit**, adding a **host primitive** (`globals/host-tools.ts`), or adding/changing a **fork role** (`fork/roles.ts`). Capabilities are **spaces, not ad-hoc globals** — there is no separate "skills" concept; to extend agents, add a system space or a function to one.

This file is a *procedure*. The catalog (which spaces exist, what each one does, what each ships), the merge/injection rules, the tasklist DAGs, materialization, and the host-primitive/fork-role reference are **knowledge** and live in `org/docs`.

## Read first (the grounded truth)

- `org/docs/system-spaces/README.md` — the catalog: what a system space IS, the **ten** shipped spaces, `system-global` (the universal toolkit), THING's triage, capabilities held by system agents, the shipped tasklists, materialization/auto-adopt, authoring rules, per-agent `model:`.
- `org/docs/contributing/add-a-space.md` — the step-by-step how-to for adding a space.
- `org/docs/format/space/README.md` (+ `agents/`, `tasklists/`, `functions/`, `knowledge/`, `components/`, `events/`) — the on-disk format you author.
- `org/docs/runtime/spaces-loading.md` — space loading + the system-space merge rules (what is universal vs. agent-scoped, collision precedence, empty-placeholder shadowing).
- `org/docs/runtime/fork-and-tasklists.md` — fork roles (`explore`/`plan`/`general`), the host-tools profile, how read-only is physically enforced, per-role models.
- `org/docs/runtime-globals/README.md` — the capability gate and what is (and is not) on an agent's model DTS; host primitives are internal-only.

Do **not** trust any list of system spaces you remember — read `SYSTEM_SPACE_NAMES` in `sdk/org/libs/core/src/spaces/system.ts`, which is the only authority.

## Procedure: add a function to an existing system space

1. Create `sdk/org/libs/core/system-spaces/<space>/functions/<name>.ts` exporting a function **named exactly like the file**, with an explicit return type and a leading doc comment (both are surfaced to the model).
2. Keep it self-contained — one function per file. Top-level helpers in the same file leak into global scope across files; inline them or name them uniquely.
3. Whether it reaches any agent depends on the space: only `system-global`'s functions are universal; every other space's functions reach an agent solely via that agent's `functions:` frontmatter. (Rules → `org/docs/runtime/spaces-loading.md`.)
4. If you added to `system-global`, update the exact-list assertion in `sdk/org/libs/core/src/spaces/system.test.ts`.
5. Build: `cd sdk/org && pnpm --filter @lmthing/core build`.

## Procedure: add a new system space

1. Create `sdk/org/libs/core/system-spaces/<name>/`.
2. Add `<name>` to `SYSTEM_SPACE_NAMES` in `sdk/org/libs/core/src/spaces/system.ts` — a dir not in that list is never materialized and never loaded.
3. Update the count assertion in `sdk/org/libs/core/src/spaces/system.test.ts`.
4. If any agent declares `capabilities:`, extend the cap-bearing predicate in `sdk/org/libs/core/src/spaces/capabilities.test.ts` (it otherwise asserts your agent's capabilities are `{}`).
5. An already-materialized pod root only picks up your edit via the pristine auto-adopt; a locally-edited copy holds back until `--adopt-system-spaces`.

## Procedure: add a host primitive

Only when a system-space function cannot be built cleanly on the existing primitives.

1. Add a `setGlobal('<name>', …)` in `injectHostTools` (`sdk/org/libs/core/src/globals/host-tools.ts`).
2. Gate it on the read-only `profile` if it mutates.
3. It is injected into both session and fork VMs. Host primitives are **internal-only** — they are not on any agent's model DTS (see `org/docs/runtime-globals/README.md` before assuming otherwise).
4. Test by injecting into a bare VM and `evalCode`-ing a call (`globals/host-tools.test.ts`).

## Procedure: add / change a fork role

1. Extend the `ForkRole` union + the preamble/profile maps in `sdk/org/libs/core/src/fork/roles.ts`.
2. Add it to `ForkGlobalOpts`/`ForkTask` (`globals/fork.ts`, `fork/fork.ts`) and the `ForkOpts.role` union in `LIBRARY_DTS`.
3. Read-only enforcement is verified in `fork/roles.test.ts` (an explore fork's write must fail *and* create no file).

## Testing

```bash
cd sdk/org                                  # NOT the repo root
pnpm test libs/core/src/spaces              # loader/merge + system-function round-trips
pnpm test libs/core/src/globals             # host primitives
pnpm test libs/core/src/fork                # roles
```

Always **also live-test**: run the built CLI against a fixture space with a real model and inspect the `--trace` NDJSON. Details → `org/docs/contributing/testing.md`, `org/docs/contributing/debugging.md`.

## Never forbid a tool in prose

Disable it structurally — `role: explore` for a read-only task, `functions: []` for a no-tools task, an explicit `functions:`/`canDelegateTo` allowlist otherwise. Frontmatter is host-enforced; prose is advisory.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the same change (see `org/docs/SYNC.md`).
