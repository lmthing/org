---
description: LOAD WHEN adding to the project you are ALREADY in — a table, a page, a rule over its data. The direct automator delegate, when it must be `add_area` instead because a genuinely new life area deserves its own specialist, and confirming the change actually landed.
---

# Adding data, events, or automation to THIS project (the LIVE-project path)

When the user wants to add something to the project you are ALREADY in — a place to STORE
data (a table), a project EVENT, a "when X happens, do Y" RULE over this project's own
data or an installed integration, OR a full app IN this project (pages + data + automation,
served at `/app/<project>/`) — delegate straight to the **automator**. It authors the table(s)
(seeding any known data), typed API handlers, React pages, emitter def(s), and event/cron hook(s)
directly into the live project (no install, no separate app). Pass the request verbatim, naming any
relevant installed-space events:

> This direct automator delegate is for an INCREMENTAL addition to a project (a table, a page, a
> scoped app request). Organising a pile of supplied material the user asked you to sort out is a
> different job with its own route — `organize_material` (path 4), per the triage preamble — not this.

```typescript
// Name the automator's own declared action explicitly — omitting it lets the automator decide FOR
// ITSELF whether to actually build or just plan/survey, and that judgment call is not reliable.
const auto = await delegate('system-appbuilder', 'automator', 'build_live_project', {
  query: '<the user request, verbatim>. Installed integration events available: '
    + '<e.g. integration-demo/message.received>',
  // If the user attached files whose data belongs in the app, hand the SAME attachment ids on
  // here — the builder reads the source itself and seeds from it. Omitting them tells the builder
  // to seed from "attached files" it cannot see, so it either fabricates or refuses to build at all.
  attachmentIds: /* the ids from the user's message, when files were attached */ undefined,
});
// Read `auto` yourself, then tell them what they can now open, in a sentence. Never dump it.
```

## When the addition opens a genuinely NEW AREA — route it through `add_area`

A table and a page are not enough when the user starts keeping a whole NEW KIND of thing the project
never covered (a distinct life area with its own standing rules, contacts, dates and knowledge
they'll keep coming back to — not just another row in an area you already have). Such an addition
deserves its OWN specialist space as well as the app, for the same reason `organize_material` gives
every distinct subject in a dump its own specialist: a later plain question about the area then has
somewhere informed to go, and the details that don't belong in any row get KEPT.

The direct automator delegate builds only the table/page — nothing in it evaluates "does this new
area deserve a specialist?", so left to a bare automator delegate the area silently gets rows but no
owning space. `add_area` is the incremental sibling of `organize_material`: it builds the app part
AND, in a fixed step that CANNOT be skipped, decides whether the area is genuinely new and, when it
is, creates its specialist via the architect (idempotent, so an existing same-topic space is reused,
never duplicated). Pass the `registeredSpaces` summary from the "Project agents (already built &
registered)" block so it knows what the project already covers:

```typescript
// A genuinely NEW area to keep and track (a new kind of thing this project had no place for):
const grown = await tasklist('add_area', {
  request: '<the user message, verbatim>',
  registeredSpaces: '<the specialist spaces already registered, from the Project agents block; "" if none>',
  attachmentIds: /* the ids from the user's message, when files were attached */ [],
  specialistFacts: '<facts only vision/audio could read, in words; "" if none>',
});
// Read `grown` yourself, then tell them what area was added and that it opens now. Never dump it.
```

For an addition that is just MORE of an area the project ALREADY covers (another row, a new column, a
rule over existing data), keep using the direct automator delegate above — do NOT spin up a new
specialist for it.

## A cheerful reply is not proof anything landed — CHECK before you say "done"

A delegate call can hand back a result that reads like progress rather than completion (a plan, a
survey of what already exists, a status with no clear success signal) — and a confident-sounding
response is not the same as a change that actually happened. Before you tell the user something is
added/changed/fixed, confirm it against REAL STATE: re-list the schema (`db.tables()`), re-query the
table, or `listProjectDir` the piece you expected to land, and look for the thing you asked for, by
name. If you cannot confirm it landed, do not report that it did — finish the job (delegate again,
naming exactly what is still missing) or say plainly that you could not confirm it, rather than
handing the user a confident sentence built on a reply you never actually checked.

**When files were attached, the `attachmentIds` above are NOT optional.** Your query will say "seed
from the CSV / the spreadsheet / the invoice"; the builder only has those bytes if you pass their
ids. A query that names attachments with no `attachmentIds` is the single most common build failure:
the builder reports back `ok:false, "cannot proceed without the attached files"` and nothing gets
built. Pass the ids on every build query that references attached material.

Everything about the project — piecemeal data/automation AND a full app IN it — goes through the
automator. Use the automator for "store tips in a `tips` table", "when a TIP: message arrives store
it", "summarize each stored tip", "poll the source every 30 minutes", "keep an audit log". There is
only ONE app-build path now (the automator into a live project); the old separate store-catalog
build has been removed.

## The chat-first lifecycle — a project is an app FROM BIRTH

Every project is created as a served app whose only page is THIS chat (a single full-height `chat`
section). So "there is no app yet" is never true and "build me an app" from inside a real project is
never a `createProject` — it is a `build_live_project` that GROWS the current project: the automator
authors the tables/pages and REPLACES the placeholder chat index (`views/index.view.json`) with real
content, and turns the assistant dock ON, so the chat you are speaking through relocates into a
floating modal on every page instead of disappearing. You do not manage any of that mechanically —
the automator does — but knowing it is why you build IN PLACE for a real project and only create a
dedicated project from the shared `user` home. When the build lands, give the app a name with
`setSessionMeta({ title })` and tell the user, in one sentence, what they can now open.

## Making this project's THING your own (`self:author`)

This project carries its OWN copy of you at `spaces/user-thing/`, and it is the copy that is running.
You hold `self:author`, so you can specialize it as you learn the project:

- `appendSelfInstruct("<a durable fact or preference>")` — APPENDS a section to your own
  instructions. It never overwrites, so it can only add to who you are, never erase it; the change is
  live on your NEXT session. Use it for things that should shape every future reply here: a currency
  or unit the user works in, how they name things, who the recurring people are, a standing "always do
  X / never do Y" they stated. Returns `{ ok, error? }` — a rejected append changes nothing.
- `writeSelfKnowledge("<field>", "<aspect>", "<markdown>")` — files heavier reference material into
  your own `knowledge/self/<field>/<aspect>.md`, for detail that does not need to be in every prompt.
- `readSelf()` — read your current instructions back before appending, to avoid repeating yourself.

Record quietly, as you go — a fact worth remembering is worth keeping — but never narrate it and never
turn it into a running log. It complements user MEMORY (path 6): memory is about the USER across every
project; `self:author` is about how you run THIS one.
