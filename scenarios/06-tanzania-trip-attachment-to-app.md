# Scenario 06 — Tanzania trip: a file attachment becomes spaces + a live, updatable app

**Persona.** Vasilis has a fully-booked August 2026 trip (Cairo → Arusha/safari → Zanzibar → Dar es
Salaam). He has one dense markdown file with everything — flights, hotels, the safari operator, a
dining reservation, visa rules, local tips. He opens a fresh project, attaches the file, and asks
THING to turn it into something he can *keep using and updating*.

**The literal user action this scenario reproduces:**
1. Create a project in the UI called **`tanzania-trip`**.
2. Attach the file `tanzaniamemories.md`.
3. Send exactly:
   > *"I am planning a trip to cairo and tanzania. I have attached all the info. Create multiple
   > spaces for the different parts of the trip and move all this info an application that you can
   > later update on the db based on the info I give you"*

**Why this scenario exists.** It is the first scenario that combines **file-attachment ingestion**
(`system-files`) with **multi-space creation** *and* the **live-project application** path — and it
directly exercises the two things S05 left conditional: the automator putting **real data into the
db** (`db:write`, not just `db:schema`), and doing so **repeatably on later messages** ("that you can
later update on the db based on the info I give you"). If this passes, THING can take a real document
and turn it into a working, updatable app — the whole product thesis in one request.

## What we expect (the contract — this is the "make sure what we expect" the request asked for)

A single vague, compound instruction on an attached file must produce, **through THING**, all of:

1. **The file is actually read.** THING delegates to `system-files` and gets the file's text, then
   extracts structured facts from it (it must reference real specifics — e.g. flight `A3932`, the
   safari operator *Suricata*, *The Rock Restaurant* — not generic filler). A run where THING never
   reads the attachment is an immediate fail.
2. **Multiple spaces, one per trip leg.** At least the four geographic legs get their own space —
   **Cairo**, **Arusha/Safari**, **Zanzibar**, **Dar es Salaam** — each a real
   `tanzania-trip/spaces/<id>/` with an agent + knowledge shaped by that leg's contents (Cairo knows
   the museum/pyramids + Eileen/Ramses hotels; Safari knows Suricata + the crater; Zanzibar knows the
   Rock reservation + driving-permit rule; Dar knows the ferry + markets). Each is delegatable with no
   restart. This is not one monolithic "trip" space.
3. **A real live-project app** at `/app/tanzania-trip/` — `built:true`, a manifest with tables + at
   least one page + api, and `GET /app/tanzania-trip/` returns **200 with real HTML** (not an empty
   shell). Built into the LIVE project, NOT a store-catalog template with a different id.
4. **The trip data is MOVED INTO THE DB** — the file's facts become rows the app serves, not just
   prose. At minimum tables for **flights**, **accommodations**, and **the safari / a dining
   reservation**, populated with the real rows from the file (6 flights, 8 accommodations, the safari,
   the Rock booking). "Move all this info into an application … on the db" means rows, queryable
   through the app's data API — the acceptance test reads them back and matches them to the file.
5. **The db is UPDATABLE on a later message.** A follow-up instruction ("*the safari balance is $960,
   due in cash on arrival — record that*", or "*add a note to the Zanzibar leg about the local driving
   permit*") must **change the db** — an insert/update the app then reflects. This is the
   "later update on the db based on the info I give you" promise, and the direct test of the
   automator's `db:write` (data-in) capability, not just `db:schema`.
6. **No `eval_error`/`typecheck_error`** across the session, and THING's routing is coherent (it does
   the spaces AND the app from the one compound ask, without dropping half of it).

**Anti-expectations (things that would be a fail even if the chat "looks" fine):**
- THING summarizes the file in prose but creates **no** spaces / **no** db → fail (it "answered"
  instead of building).
- The app builds but the tables are **empty** → fail (schema without data is the S05 gap; this
  scenario exists to close it).
- The data lands in a store-catalog project with a different id, leaving `tanzania-trip` empty → fail
  (the S05 `build_app`→catalog routing bug).
- The later-update message produces prose ("I've noted that") but **no db change** → fail.

## Setup

The runner (`06-tanzania/run.mjs`) provisions a fresh prod user, **creates the `tanzania-trip`
project via the API (the UI action)**, uploads `tanzaniamemories.md` via `POST /api/uploads`, and
sends the message **with the attachment** (the WebSocket send path the UI uses — the HTTP `/message`
route is content-only). It then drives the follow-up update and asserts against real pod DB rows +
the served app.

```bash
cd sdk/org/scenarios/harness && node ../06-tanzania/run.mjs
```

The source file is copied into the repo at `sdk/org/scenarios/06-tanzania/fixtures/tanzaniamemories.md`
so the scenario is self-contained and reproducible (the original lives at
`/home/vasilis/Trips/august2026/tanzaniamemories.md`).

## Acts & expected outcomes

### Act I — Ingest: the attachment is read, not ignored
Create `tanzania-trip`, upload the file, send the real message with the attachment.
**Expect:** THING delegates to `system-files` (a `delegate` yield to `system-files/*`), the file text
reaches the model, and THING's plan references **real specifics from the file**. Assert: the
`system-files` delegate happened; the response names ≥3 concrete facts that only appear in the file.

### Act II — Multiple spaces, one per leg
**Expect:** ≥4 spaces created under `tanzania-trip/spaces/`, covering Cairo, Safari/Arusha, Zanzibar,
Dar es Salaam. Assert: the space dirs exist; each is delegatable; a leg-specific question routes into
the right space (e.g. *"what's my dinner reservation in Zanzibar?"* → the Zanzibar space answers with
*The Rock*, Aug 15).

### Act III — A real app on the live project
**Expect:** THING delegates to `system-appbuilder` and authors a live-project app. Assert:
`GET /api/projects/tanzania-trip/app` → manifest with tables + ≥1 page + ≥1 api;
`POST …/app/build` → `built:true`; `GET /app/tanzania-trip/` → 200 real HTML.

### Act IV — The data is in the db (the crux)
**Expect:** the file's facts are rows. Assert via `GET /api/projects/tanzania-trip/app/data/<table>`:
- a **flights** table with the 6 legs (ATH→CAI, CAI→DAR, DAR→ARK, ARK→ZNZ, DAR→CAI, CAI→ATH), dates
  and refs where present;
- an **accommodations** table with the 8 stays (Eileen, Serengeti Villa, the safari camps, Kutoka,
  Treasures, Ayla, Sunny Shore, Ramses);
- the **safari** (Suricata, Aug 7–9, $1,200 / $240 paid / $960 due) and the **Rock** dining reservation
  (Aug 15) captured as rows.
Row *contents* are matched against the file — not just row counts.

### Act V — Update the db from a later message (the promise)
Send a follow-up: *"Record that the safari balance of $960 is due in cash on arrival, and mark the
Zanzibar leg as needing a local driving permit (~$15)."*
**Expect:** THING makes a **db change** — an update to the safari row (balance/status) and/or an insert
into a notes/requirements table — and the app reflects it. Assert: the specific row changed in
`GET …/app/data/<table>` between before and after; no full rebuild required (live republish).

### Edges
- **Bilingual:** a follow-up in Greek (*"Πρόσθεσε ότι χρειάζομαι ταξιδιωτική ασφάλιση για τη Ζανζιβάρη"*)
  must still route + update, per the file's own note that the user mixes Greek/English.
- **Idempotent re-ask:** re-sending "create the spaces" must not clobber the spaces already built.
- **Big-file safety:** the ingest must not blow the token budget or emit malformed authoring code
  (the S05 reliability surface — validate-before-write must catch any unparseable authoring).

## Assertions the runner makes (trace + real state)
- `system-files` delegate observed; plan cites file-specific facts
- ≥4 leg spaces exist + are delegatable
- `/app/tanzania-trip/` builds (`built:true`) and serves 200 real HTML
- flights / accommodations / safari+dining tables exist AND are **populated with the file's rows**
- the Act V follow-up **changes a db row** (before/after diff), app reflects it
- 0 eval/typecheck errors; no store-catalog-with-wrong-id; no empty-table "success"

## Performance targets
| Metric | Target |
|---|---|
| Attachment ingest → THING plan | < 90 s |
| Whole build (spaces + app + data) | < 15 min |
| `/app/tanzania-trip/` first byte | < 3 s |
| Later-update message → db row changed | < 90 s |
| Eval/typecheck errors | 0 |

## Actual results

_Filled in by the scenario runner — see `sdk/org/scenarios/results/06-tanzania-report.md`._
