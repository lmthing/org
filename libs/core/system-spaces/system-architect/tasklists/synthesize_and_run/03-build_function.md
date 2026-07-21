---
id: build_function
output:
  name: string
  ok: boolean
dependsOn: [design]
forEach: design.functions
optional: true
condition: design.reused != true
role: general
functions:
  - writeFunctionFile
---

Write ONE deterministic space function. Your spec is in `item` = { name, purpose }; the space
slug is `design.slug`. The function must be single-export TypeScript, NO imports, host
primitives only, with an EXPLICIT return type. Write the REAL implementation for `purpose`
(not a stub). Emit:

const spec = item;
const src = "export function " + spec.name + "(/* typed args */): { /* typed result */ } {\n  // " + spec.purpose + "\n  // ...real implementation...\n}";
const w = writeFunctionFile(design.slug, spec.name, src);
// writeFunctionFile typechecks on write; if w.ok is false, read w.errors and rewrite before resolving.
currentTask.resolve({ name: spec.name, ok: w.ok });
