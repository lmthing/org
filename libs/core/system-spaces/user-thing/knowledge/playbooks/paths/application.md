---
description: LOAD WHEN you are about to build an APP, or about to OFFER one (path 4) — before any authoring delegate. The did-they-ask gate, what an offer turn may contain, the organize_material call, seeding from attachments, and checking before you announce.
---

# Path 4 — build an APPLICATION

For when the user EXPLICITLY asks for a working *app*: a UI they can open (pages/screens/"an app I
can open on my phone"), a dashboard, and/or persistent data with web pages — e.g. "build me a
personalized feed", "an app to track my workouts", "a reading list with a page to mark items read",
"turn this into an app I can open".

> **GATE — before ANY authoring delegate, answer one question: did they ASK?**
> There are exactly two entry tickets to path 4: **(a)** the user asked for something they can
> open, in their OWN words, or **(b)** they said yes to an offer YOU already made. If you are
> holding neither ticket, you may **not** delegate to a builder on this turn — however obvious
> the app is, and however much material they just handed you. **A pile of material plus a
> frustration is a cue to OFFER, never a licence to build.** Building unasked is not
> helpfulness: it spends their time on a shape they never chose and takes the decision away
> from them. An OFFER turn ends with a question and contains **zero** authoring delegates.

**Do NOT scaffold an app on a vague or exploratory request.** Building an app is a large,
expensive commitment — never the response to "start a project", "help me keep track of X",
"set up a project for my trip", or any opening message that does not name a UI/pages/dashboard.
For those, take path 1: converse, orient, and set the project up LIGHTLY (answer, capture what
they told you). Grow the project incrementally (documents, then per-topic spaces via path 3)
and only reach for path 4 LATER, when the user actually asks to turn it into an app. If in
doubt, ask one short clarifying question instead of building — an unwanted 6-table app is a far
worse failure than one extra question.

**But OFFER — do not wait to be asked.** Restraint is not silence. The user does not know an app
is even on the menu, so they will never name one; they will just describe a mess and hand you
their material. When the user gives you SUBSTANTIAL MATERIAL (documents, a spreadsheet, photos,
a data dump) **and** describes an ONGOING need to keep track of it ("I keep losing this", "I
can't stay on top of it", "I don't want to be digging through files when it matters"), that is
your cue to **propose** — in one short, plain sentence, offering to put it somewhere they can
open and check, naming the REAL specifics you just read so they can tell you actually read them.
Then **STOP and wait**. Do not author anything on the same turn as the offer.

## Their agreement is the request — then run the organizer

Their agreement is the explicit request path 4 requires — and it will be plain and unspecific
("yes please", "go on then", "sure"). A bare yes to YOUR OWN offer is CONSENT: when the offer
was to organize supplied material, first get the project right — **if you are still in the shared
`user` project, `createProject` a dedicated one before anything else**, naming it yourself from
what they handed you (this is your call to make, not a question to ask); the organizer then builds
into it, never into `user`. Then, in the SAME turn, emit the organizer call as **one self-contained
statement** that starts the organizer and composes the closing reply from its envelope inline —
values do not persist into a later statement:

```typescript
// Still in the shared `user` project? Create the dedicated project FIRST — propose the name
// yourself, never ask for one. Already in a real project? Skip this line; build in place.
createProject('<a short name for what they are organizing>');
await tasklist('organize_material', {
  request: '<what you offered>',
  sourceSummary: '<the short attachment summary>',
  attachmentIds: ['<the supplied file ids>'],
  specialistFacts: '<the image/audio-only facts>',
}).then((organized) => display(
  organized.ok
    ? 'Everything is organized and ready to open.'
    : 'I organized what I could, but part of the setup needs another look.'
));
```

The organizer owns the complete build FROM WHICHEVER PROJECT IT RUNS IN — get that right before
you call it, not after. Do NOT delegate to the automator or architect, call the organizer again,
or continue authoring after that statement; it alone inventories independently owned scopes,
builds every grounded specialist, then hands the complete source to the live-project builder.
Its envelope is the proof of the workflow's outcome: do not inspect the project or try to
validate individual builder results afterwards. That creates a second, lossy implementation of the
workflow and can restart completed work. Do not ask them to spec it out, and never make them ask
twice — re-offering the thing they just accepted is the same failure as never offering it.

**Supplied material is the complete build source, not a research prompt.** When a part is grounded
in files, images, audio, or facts the user supplied, seed those facts into its architect handoff
and do not call its freshly-created `answer` action during setup: that action is for a later
question, and an incomplete seed makes it look like a knowledge miss that triggers web research.
Use the extracted facts directly in the handoff; only a later user question that the supplied
material, DB, and that space's knowledge do not cover may research. This applies even if the
material describes a famous place or topic — familiarity is not a missing fact.

## One app-build path — the automator into a LIVE project

Every app is built by the **automator** DIRECTLY into a live project — it authors the tables
(SEEDING any known data the user gave you), typed API handlers, React pages, and hooks, and the
project then serves at `/app/<appId>/`. There is no separate store-catalog template any more.
Before you delegate, decide which project it builds into (the WHERE rules are in your
instructions, and in full in `loadKnowledge('playbooks', 'building', 'create-project')`):

- **Current project is REAL (id is NOT `user`)** → build IN place: delegate to the automator with
  no `createProject`. "Turn this into an app", "make an app I can open for this", "move all this
  info into an app", or any app built ON data/spaces/a file already in this project lands here,
  and their existing data moves straight in.
- **Current project is `user`, OR the user wants a NEW project** → ASK for a project name (unless
  given), `createProject(<name>)`, THEN delegate the automator build; the runtime retargets it
  into the new project. **NEVER build into `user`.**

Pass the request verbatim; if the data came from an attached file, include the extracted facts so
the automator can seed them.
**If the data to move in came from an ATTACHED FILE, hand the file to the automator directly** via
`attachmentIds` — do NOT retype the data into the query (you only have a summary of it, so
retyping loses rows). The automator reads the full file itself (`readDocument`) and seeds every
row. Pass the SAME attachment id(s) the user sent you:

**But hand over the facts only a SPECIALIST could read — those it CANNOT re-read.** The builder
can open an attached *document* itself, but it **cannot see an image and cannot hear audio**. So
any fact that exists only because vision or transcription read it for you is LOST unless you put
it in the `query` yourself, in words. Pass the readable files by `attachmentIds`, **and** pass the
specialists' extracted facts as text alongside them. A deliverable that silently drops everything
the camera and the microphone gave you is a broken deliverable — and the user, who watched you
read those things, will believe they are in there.

```typescript
const app = await delegate('system-appbuilder', 'automator', 'build_live_project', {
  query: '<the user request, verbatim>. Build this into an app IN this live project. Read the '
    + 'attached file and MOVE ALL of its data into the app database as seeded table rows.',
  attachmentIds: [/* the id(s) of the file(s) the user attached */],
});
// Read app yourself, then tell them what they can now open. Never dump it.
```

**Before you tell them it is ready, CHECK that it is.** A builder that comes back cheerful is not
proof of anything — the only proof is the deliverable. So after the build, LOOK at what actually
landed (`listProjectDir`) and ask the question the user will ask: *can they open it?* A project
with tables and no page is not an app they can open — it is data in a drawer, and announcing it as
live is a lie they will discover the moment they tap the link. If a piece is missing, finish it
(delegate again, naming exactly what is absent) or say plainly what is and is not there. Never
announce a deliverable you have not seen; "it's ready! 🎉" on an empty app is the worst answer we
can give, because it costs them the trust to check.

When there is NO file — the data is only in your conversation — put the concrete facts in the
`query` string instead (`delegate`'s opts take only `{ query, attachmentIds }`; a stray
`data:`/`rows:` key fails typecheck). Either way, tell the user what was built and that they can
open it at `/app/<project>/` now.

Whether you build in place or into a project you just created with `createProject`, the app is
authored into the LIVE project and served at `/app/<appId>/`. NEVER design or write an app
yourself — only the automator holds the authoring tools.
