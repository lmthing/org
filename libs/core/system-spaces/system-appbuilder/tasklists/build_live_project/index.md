---
input:
  query: string
  attachmentIds: array
---

Build a complete, openable live-project app from supplied material — as a PLAN → per-item BUILD
pipeline, so no single model turn has to author a whole app at once. First read the attachments, then
distil the request + material into the USER STORIES the app must satisfy, then make a holistic,
BINDING plan of the app (its tables, endpoints, reusable components, and MULTIPLE pages) that serves
every story. From there each category is a `plan → implement` pair that the host fans out one file at a
time, each planner threaded with the stories + the binding plan + the artifacts already built upstream:
plan the tables → write each table (with its source-derived rows), plan the endpoints (grounded in the
real written tables) → write each typed API, plan the components → write each reusable component, plan
the pages → write each page (which imports the components and reads the endpoints). A final node writes
the persistent chat layout and reports what was built. Every write is its own bounded node, so a slip on one file no longer loses the build;
each writer returns `{ ok, error? }` and validates at write time. Pages use `@app/runtime` data hooks
and `@lmthing/css` design tokens only.
