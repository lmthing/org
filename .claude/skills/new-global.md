---
name: new-global
description: Load when adding a new value-yielding global (ask, sleep, inspect, fork, delegate, tasklist, loadKnowledge, registerSpace).
---

# Skill: Adding a Runtime Global

Load this when you are adding (or changing the wiring of) a **global** — a function or object the
host binds on the QuickJS sandbox's `globalThis` so model-authored TypeScript can call it: a
yielding global (`ask`, `sleep`, `fetch`, `emitEvent`, …), a synchronous host primitive, or a
fire-and-forget one (`display`). It is a *procedure*; the knowledge lives in `org/docs/`.

**Prefer a space function.** New capability usually belongs in
`libs/core/system-spaces/system-global/functions/` (or another space), built on top of the existing
primitives — `webSearch`, `todoWrite`, `grep` all work that way. Add a core global only when you
need a host-side effect that ends the turn (a yield) or a raw host primitive. See
`@.claude/skills/system-spaces.md`.

## Read first (the grounded truth)

- `org/docs/contributing/add-a-global.md` — **the step-by-step, code-cited procedure**: the three
  kinds of global, the factory shape, the `YieldRequest` union, the single injection site, the yield
  router, capability gating, the DTS fragment, consent marking, tests, and the final checklist.
- `org/docs/runtime-globals/README.md` — what globals exist today (full table), yielding vs
  non-yielding, the app capabilities and what each earns, the "not granted ⇒ not injected AND absent
  from the DTS" invariant, the host-resolver third gate, bootstrap order, function allowlists.
- `org/docs/runtime-globals/*.md` — the family your global joins (`conversation`, `delegation`,
  `data-db`, `app-authoring`, `events-and-integrations`, `store-and-consent`,
  `knowledge-and-docs`, `session-and-utils`). Your global must be added to the right one.
- `org/docs/runtime/typecheck.md` — how the ambient DTS is assembled per capability profile.
- `org/docs/runtime/turn-loop.md` — how a resolved yield value is bound host-side onto the
  statement's binding pattern (matters if your global is used under `Promise.all` / destructuring).
- `org/docs/format/space/agents/capabilities.md` — the `capabilities:` frontmatter that grants
  project-app globals.

## Procedure (order of operations)

Follow `org/docs/contributing/add-a-global.md` for the code-cited detail of each step. The order:

1. Write the factory in `libs/core/src/globals/<name>.ts`.
2. Add the `kind` literal to the `YieldRequest` union (`libs/core/src/eval/yield.ts`).
3. Inject it in `createChildVM` (`libs/core/src/exec/bootstrap.ts`) — the **one** injection site
   shared by session, fork and delegate — behind an explicit capability check.
4. Resolve the yield with a `case` in `routeCommonYield` (`libs/core/src/eval/yield-router.ts`),
   threading the host dep through `YieldRouterContext`; fail loud if the resolver is absent.
5. If project-app scoped: add the capability id (`libs/core/src/spaces/capabilities.ts`) and decide
   its read-only-fork behaviour in `intersectAppCaps` (`libs/core/src/exec/capability.ts`).
6. Add the ambient DTS fragment (`libs/core/src/typecheck/library-dts.ts`) — **in lockstep with
   injection**.
7. Universal globals only: add the model-facing bullet in `globalsSummary`
   (`libs/core/src/context/system-block.ts`).
8. If it carries user-visible authority: mark it in `CONSENT_MARKED_YIELD_KINDS`
   (`libs/core/src/globals/consent.ts`).
9. Test: factory unit test in `libs/core/src/globals/<name>.test.ts` (mock `pushYield`, assert
   `kind`/`args`, assert the promise resolves on `deferred.resolve`) **plus** the DTS-lockstep test
   in `libs/core/src/exec/bootstrap.test.ts`.

Run:

```bash
cd sdk/org
pnpm test libs/core        # NOT `pnpm --filter @lmthing/core test` — core has no test script (silent no-op)
pnpm typecheck
```

For a synchronous host primitive instead, add it inside `injectHostTools`
(`libs/core/src/globals/host-tools.ts`) — the one place session and fork VMs share; honour
`profile.allowWrite` if it mutates, declare it in the right DTS fragment, and test it in
`host-tools.test.ts`. For project-rooted effects (`db`, the `writeProject*` writers) extend
`injectAppGlobals` (`libs/core/src/exec/app-globals.ts`) instead.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see org/docs/SYNC.md). For a new global that means at minimum
`org/docs/runtime-globals/README.md` (the full global table + the capability table) and the family
sub-doc it belongs to.
