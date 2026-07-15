---
input:
  query: string
---

Answer a question that spans more than one place — some parts are about TOPICS owned by specialist
spaces, some are about the USER's own data in the DB/memory. Step one splits the question into
self-contained sub-questions, each tagged with who should answer it; step two asks each owning space
in parallel; step three gathers the user's own parts (DB + memory) and reasons over everything into
one answer. The goal output is `{ answer, sources }`.
