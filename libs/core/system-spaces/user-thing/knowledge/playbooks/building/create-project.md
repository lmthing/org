---
description: LOAD WHEN an app needs a PROJECT to live in — you are in `user`, or the user wants a new one. Where an app gets built, why `user` is never it, and why createProject is step 1 of 2 rather than the finish line.
---

# Creating projects — you CAN, via `createProject`

You hold `project:manage`, so you can create a live project yourself with `createProject(name)`
(and re-target an existing one with `selectProject(id)`). `name` is a human display name; the host
slugifies it into the project id and returns `{ ok, appId, root }`. After `createProject`/
`selectProject`, the NEXT `delegate('system-appbuilder', 'automator', 'build_live_project', ...)`
build is AUTOMATICALLY retargeted by the runtime to build INTO that project — you do NOT pass a
projectId to `delegate`.

**The rules for WHERE an app gets built:**

- **Current project is a REAL project (its id is NOT `user`)** → build INTO it: delegate straight to
  the automator, no `createProject`. This is the default when the user is already working inside a
  named project.
- **Current project is `user` (the default), OR the user explicitly wants a new project** → ASK the
  user for a project name first (unless they already gave one), then `createProject(<name>)`, then
  delegate the automator build. The runtime builds into the new project.
- **NEVER build an app into the `user` project.** It is the shared default home, not an app.

Report the real openable URL `/app/<appId>/` using the `appId` `createProject` returned (or the
current project's id when you built in place).

**`createProject` is NOT the finish line — it is step 1 of 2.** Creating a project and then stopping
leaves the user an EMPTY project and no app: that is a FAILURE, not a completed request. In the SAME
turn, immediately after `createProject` succeeds, you MUST `delegate` to the automator to build the
app. Do NOT end the turn, do NOT just `display(proj)` and stop, do NOT wait for the user to ask again
— create, then build, back to back:

```typescript
// In the `user` project (or when the user wants a new project) — ask for the name first, then:
const p = createProject('My Todos');
if (!p.ok) throw new Error(`could not create the project: ${p.error}`);
// DO NOT stop here. Build the app into the just-created project in this SAME turn. Name the
// automator's own declared action explicitly — omitting it lets the automator decide FOR ITSELF
// whether to actually build or just plan/survey, and that judgment call is not reliable:
const app = await delegate('system-appbuilder', 'automator', 'build_live_project', {
  query: '<the user request, verbatim>. Build this app into the current project, with its tables, pages and seed rows.',
});
// Only NOW is the request done — tell the user it opens at `/app/${p.appId}/`.
```

One exception to "ask for the name": when the user has just said YES to your offer to organize
supplied material, name the project YOURSELF from what they handed you and create it before calling
the organizer — that naming is your call to make, not a question to ask.
