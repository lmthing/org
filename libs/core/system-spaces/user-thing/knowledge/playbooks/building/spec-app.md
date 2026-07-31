---
description: LOAD WHEN the user asked for a phone-native / spec-based app, OR before ANY build into a project that already has pages. Which builder to route to and why almost nobody asks for it in our words — and that an app which already exists KEEPS the builder that made it.
---

# There is a SECOND builder, and you use it ONLY when the user explicitly asks for it

`system-viewbuilder` builds the same kind of app — same tables, same API, same automation — but its
PAGES ARE SPECS rather than React, which is what lets them render natively inside the mobile app with
no WebView. Its UI vocabulary is a fixed menu, so a genuinely bespoke surface is something it will
tell you it cannot express.

Route to it **only** when the user asks for it — but note that almost nobody asks for it in our
words. The jargon counts: a **spec-based / spec-driven app**, a **natively-rendering** app,
**without a WebView**, or the viewbuilder by name. So does the same requirement in ordinary speech,
which is how it will usually arrive: *"it has to run on the phone itself, not a website squeezed
into an app"*, *"a proper phone thing, not a web page in a wrapper"*, *"the last one was a site
bolted into an app and it timed out every time"*.

The line is **a requirement about HOW IT MUST RUN, not a mention of where it will be used.**
"I'll mostly use this on my phone" / "it should work on mobile" / "make it responsive" is a *context*
— that is the appbuilder, whose apps already work on a phone. "It must BE a phone app rather than a
wrapped website", stated as a condition, is the ask. If you genuinely cannot tell which one you heard,
ask them — one plain question, because switching builders on a guess spends their choice for them.

**Everything else — every ordinary "build me an app", every incremental addition, every
`organize_material` build — keeps going to `system-appbuilder` exactly as it does today.** Do not
switch builders because an app "sounds simple", because a phone was mentioned in passing, or on your
own judgement. Same action, same input, so nothing else about the path changes:

```typescript
// ONLY when the user explicitly asked for a spec-based / natively-rendering app:
const app = await delegate('system-viewbuilder', 'automator', 'build_live_project', {
  query: '<the user request, verbatim>. Build this as a spec-based app in this live project.',
  attachmentIds: /* the ids from the user's message, when files were attached */ undefined,
});
// Read `app` yourself. If it reports `cannotExpress` entries, TELL the user which part of which page
// the spec vocabulary could not express and why — that is an honest gap, and the appbuilder is where
// that surface would have to be built instead. Never quietly drop it.
```

## An app that already exists KEEPS the builder that made it

The medium is a property of the WHOLE app, not of the page being added, so one page authored the
other way ends the guarantee the original choice was made for — and it cannot be undone by the next
turn. So before any build into a project that already has one, look at what is there
(`listProjectDir('pages')`) and match it: `*.view.json` specs are the spec builder's, `*.tsx` pages
are the default builder's. Changing medium halfway is not a build, it is a REVERSAL of a requirement
somebody stated — and the person asking for the next feature is usually not the person who stated it.
Put it to them, naming what they gain and what they give up, and let them settle it (in a team
workspace that is `settle_team_decision`, in `('playbooks','team','workflows')`). Two specific traps:

- **Never reason from the requirement to the switch.** "They said it must run natively, therefore I
  will rebuild it in the medium that cannot" is the shape this mistake takes, and it reads as
  reasoning right until you notice the conclusion contradicts its own premise. A requirement is never
  an argument for the thing it rules out. If you catch yourself citing somebody's constraint while
  choosing against it, you have already lost the thread — stop and ask.
- **Never predict on a builder's behalf that it cannot express something.** Whether its vocabulary
  covers a surface is its report to make, in `cannotExpress`, and only after it has actually tried.
  Your guess that it would have failed is not evidence that it did — and a rebuild you launched on
  that guess cannot be given back.
