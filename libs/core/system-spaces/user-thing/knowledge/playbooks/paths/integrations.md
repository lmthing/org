---
description: LOAD WHEN the request touches an external SERVICE (path 7) — Gmail, Calendar, Slack, GitHub — or asks to automate 'when X happens, do Y'. The find -> consent-install -> keys -> automate flow, and the storeInspect guard that stops an unfulfillable consent card.
---

# Path 7 — act on / automate a service (Gmail / Google Calendar / Slack / GitHub / …)

When the user asks you to DO something on an external service, or to AUTOMATE "when X happens, do Y
and post back", handle it in this order. If the needed integration is ALREADY installed (registered
under its own name, reachable via `registered:*`), just delegate to it — an installed integration
already holds its own credentials:

```typescript
// e.g. "post to #general" when a Slack integration is installed/registered:
const s = await delegate('integration-slack', 'slack', { query: '<the user request, verbatim>' });
// Read s yourself, then confirm it went out. Never dump it.
```

Otherwise, run the install-and-automate flow — you do NOT build integrations, and you no longer
send the user off to studio; you install and wire it up right here:

**One request can name MORE THAN ONE need** ("receive tips from my chat tool AND keep an audit trail
of the automations"). The finder returns ONE space per call, so decompose: run steps (a)–(c) — a
separate `finder` delegation and `installSpace` — ONCE PER DISTINCT need, then wire the automation.
Do not stop after the first install when the user asked for two things; each install raises its OWN
consent card.

**(a) Find the right space.** Delegate discovery to the store finder (it searches the catalog and
validates FIT — that the space emits the events and exposes the actions the request needs). Pass the
user's need verbatim:

```typescript
const rec = await delegate('system-store', 'finder', { query: '<what the user wants to do/automate, verbatim>' }) as {
  fit: boolean; spaceId?: string; title?: string; why?: string;
  emits?: string[]; actions?: string[]; requiredSettings?: string[]; reason?: string;
};
```

If `rec.fit` is false, tell the user nothing in the store covers it (relay `rec.reason`) and stop —
do NOT try to build one.

**(b) Install it (consent-gated).** Present the recommendation briefly, then call `installSpace` —
the host shows the user a consent card and installs only on approval. On success the space is
live-registered for `delegate()` this same session:

```typescript
const inst = await installSpace(rec.spaceId!);   // pauses for the user's consent card
// Read the failure from `inst.error` ONLY (the canonical failure field). Do NOT also read
// `inst.message`, and do NOT assign `inst` from a `cond ? installSpace(...) : { ok:false, error }`
// fallback — a union with an `{ ok, error }` branch makes `.message` fail typecheck.
display(inst.ok ? `Installed ${rec.title}.` : `Install failed: ${inst.error ?? 'unknown error'}`);
```

A denied card rejects — do not retry unless the user asks again.

**NEVER call `installSpace` on an id you have not confirmed exists in the store** — not even an id
the user typed verbatim. Installing is consent-gated, so a call to `installSpace('<id>')` ALWAYS
interrupts the user with a consent card; asking them to approve installing something that cannot be
installed is wrong. Before the FIRST `installSpace` for a given id that did NOT come from a finder
recommendation (`rec.spaceId`), verify it with `storeInspect` and only call `installSpace` when it
resolves. If it doesn't exist, tell the user plainly and STOP — do not call `installSpace`:

```typescript
const found = await storeInspect('<the exact id>');   // undefined ⇒ not in the catalog
if (!found) { display("There's no such integration in the store, so I can't install it."); }
else { const inst = await installSpace(found.id); /* … as above … */ }
```

(`storeInspect`/`storeSearch` are a lookup ONLY — for "what can you connect me to?" discovery you
still delegate to the finder in step (a); do not self-search there.)

**(c) Guide key setup.** If `rec.requiredSettings` is non-empty (or the space needs a webhook),
check what is still missing and point the user at the chat **Integrations** tab to fill the keys.
`integrationStatus` is presence-only (names, never secret values) and also surfaces the inbound
webhook URL to register with the provider:

```typescript
const st = await integrationStatus(rec.spaceId!) as { ready: boolean; missingRequired: string[] };
display(st.ready
  ? 'All keys are set.'
  : `Open the Integrations tab and fill: ${st.missingRequired.join(', ')}. I'll pick up automatically once you save.`);
```

The user's save restarts the pod and AUTO-RESUMES you with a "<id> configured" system message —
continue the flow from there; never poll or block waiting on keys.

**(d) Author the automation.** For a "when X, do Y" rule, delegate to the automator — it writes the
project's event hook (subscribing to the space's event) and any emitter def:

```typescript
const auto = await delegate('system-appbuilder', 'automator', 'build_live_project', {
  query: 'When <event, e.g. integration-slack/message.received> happens, <do Y>. Available events: '
    + (rec.emits ?? []).join(', ') + '; available actions: ' + (rec.actions ?? []).join(', '),
});
// Read auto yourself, then tell them what will now happen on its own. Never dump it.
```

**(e) Missing operations.** If the automation needs a service call the installed space does NOT
expose, delegate to the engineer to WRITE the project function (path 5) — it returns
`{ kind:'projectFunction', code, suggestedName }` — then hand that result to the automator to
persist with `writeProjectFunction` (the engineer cannot persist; only the automator holds
`hooks:write`).
