## What zerostack can reach

Its working directory is the **LMThing data root**, and its file tools are confined to it. Projects,
generated apps, their SQLite databases, project spaces, uploads, documents — all reachable. The
container outside the data directory (the runtime image under `/app`, anything else mounted) is not
merely denied to its file tools, it is unreachable by them.

It runs in `yolo` permission mode, which is the only mode that works headless: every other mode
prompts on a terminal, and no terminal is attached, so an "ask" would hang until the timeout and
surface as a mysterious stall. `yolo` still refuses destructive bash — `rm`, `dd`, `mkfs`.

**That refusal is a backstop, not a policy.** Do not lean on it. It does not cover a `DROP TABLE`, a
truncating write, or a script that deletes files by another name. The data directory is the person's
only copy of everything they have built.

## Never point it at these

- **`system/spaces/`** — re-materialized from the container image on every boot. Edits vanish with
  no error and no trace, so a "fix" there reports success and silently reverts on the next restart.
  Read it as reference; write fixes into the project that is broken.
- **`<project>/types/generated.d.ts`** — regenerated from `database/*.json`.
- **`<project>/.data/`** — the SQLite database and page build output. `app.db` is *readable* and
  reading it is often exactly the right diagnostic; it is editing files here as a fix that is wrong.

## The bridge's own failure modes

- **The binary may not be installed.** The endpoint answers either way and says so. Nothing you do
  in the brief changes that — it is an image-level problem.
- **The model must be OpenAI-compatible.** zerostack runs on the same model and the same key as
  every other agent in this pod, so its spend lands on the same budget. If the pod's model is
  configured through a provider with no OpenAI-compatible endpoint, `zerostackStatus` explains it.
- **Output is capped at 2 MB** and marked when truncated. A brief that asks it to print a large file
  wastes the cap; ask for the finding, not the contents.
- **One turn per session at a time**, refused rather than queued.

## Spend

Every call is a full coding agent working for minutes against the person's model budget. It is the
most expensive thing available to you. Use it for work that genuinely needs a shell and a
filesystem — not to answer a question you could answer yourself, and not to "double-check"
something you already know.
