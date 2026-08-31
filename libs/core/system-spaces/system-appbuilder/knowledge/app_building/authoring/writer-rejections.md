---
description: LOAD WHEN a spec writer returned { ok:false } — the error is MENU-SHAPED and already names the field, the mistake and every legal answer, so fix that one field rather than resubmitting or deleting the section.
---

# Reading a writer's rejection

Every spec writer returns a MENU-SHAPED error:

```
sections[1].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe?
Mutations: addRecipe, importRecipe, importRecipeText
```

That names the field, the mistake, and every legal answer. **Edit that ONE field and write again.**
Never resubmit the same object, never delete the section to make the error go away, and never treat
`w` as an array — it is `{ ok, error? }`, so branch on `w.ok`.

## When the error is a TYPECHECK error, not a writer rejection

`Argument of type '{ … }' is not assignable to parameter of type 'ViewSpec'` (a `[error]` you see
BEFORE the call ever ran) is the degraded form of a rejection: the argument was a HOISTED const or a
forwarded PLAN object, not a fresh literal. It names no field, so patching it is a coin flip.
Re-author instead — write the spec INLINE in the writer call, and the same fault becomes precise:
`"purpose" is not a property here. Properties: layout, route, sections, title`. If the argument was
the plan item itself (`purpose`/`endpoints`/`components` present), the OBJECT is wrong, not a field:
plan sections are design notes — plan `endpoint` → `query`/`mutation`, plan `bindings` →
`item`/`cards` — so construct a fresh spec; deleting three plan fields is not authoring.
