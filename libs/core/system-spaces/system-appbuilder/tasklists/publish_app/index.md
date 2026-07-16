---
input:
  request: string
---

Publish an app to the store CATALOG (`store/projects/<id>/`) from a natural-language `request`. This
is a thin wrapper: a single node delegates the whole build to the app-architect's `build_app`
pipeline, which designs and writes the catalog project file-by-file. It is not wired into THING and is
kept deliberately minimal — the catalog path is not a priority right now.
