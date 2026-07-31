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
