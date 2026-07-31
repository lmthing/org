---
description: LOAD WHEN data has to get INTO the app — rows the user handed you to seed at table creation, data the app collects from the user through a create section, or data arriving on a schedule or an event.
---

# Getting data IN

**KNOWN data the user gave you to MOVE IN — seed it at table creation.** Pass it as the THIRD
argument of `writeProjectTable(name, schema, rows)`; the host inserts those rows right after the table
is created (a table you create in this turn only becomes queryable through `db.*` afterwards).
**Data the app COLLECTS from the user** arrives through a `create` section, whose form fields derive
from the mutation endpoint's `Input` schema — you never declare form fields. **Data that arrives on a
schedule or from an event** is a hook's job.
