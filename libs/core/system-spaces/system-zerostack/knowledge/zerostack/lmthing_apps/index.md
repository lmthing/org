---
variable: lmthingApps
---

The repair skillset for LMThing-generated apps: what they look like on disk, how they break, and
how a fix is actually proved.

An LMThing **project** can own a full application built on the pod runtime — a project-rooted
SQLite database, worker-isolated Node API handlers, client-side React pages, in-proc hooks, and its
own project-scoped spaces. Those apps are usually written by another agent (`system-appbuilder`),
which means the failures are not random: they cluster into a handful of shapes that recur across
every generated app.

Everything here is context zerostack cannot guess. **Put the relevant part into the brief** — a
strong general engineer meeting this layout for the first time will otherwise spend most of its
turn rediscovering, badly, what one paragraph would have told it.

Load the aspect that matches the symptom:

- **`app-anatomy`** — the on-disk layout, what each directory means, and which files are generated
  and must never be hand-edited.
- **`failure-modes`** — the recurring breakages, symptom → cause, in the order worth suspecting.
- **`verification`** — how to prove a fix: the typecheck, the database, the page build.
- **`spaces-and-agents`** — when the broken thing is an agent or a space rather than app code.
