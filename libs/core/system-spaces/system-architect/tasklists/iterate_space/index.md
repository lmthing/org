---
input:
  spaceKey: string
  feedback: string
---

Improve an existing synthesized space: locate it (`spaceKey` — a dir or key; may be empty, in
which case the load step discovers it), diagnose what the user's `feedback` asks to change,
re-write only the affected files with the per-file builders, re-validate, re-register, and
package the re-run parameters so the caller can run the updated agent and verify the improvement.
