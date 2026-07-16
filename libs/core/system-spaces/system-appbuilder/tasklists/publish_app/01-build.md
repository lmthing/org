---
id: build
output:
  result: object
dependsOn: []
goal: true
role: general
functions: []
canDelegateTo:
  - system-appbuilder/app-architect#build_app
---

Publish the app by delegating the whole build to the catalog builder. `request` is in scope. Run
`build_app` on the app-architect (it owns the catalog authoring globals + the file-by-file design →
create → tables → API → pages → hooks pipeline) and resolve its result for the caller. Emit one
statement:

```typescript
const result = await delegate('system-appbuilder', 'app-architect', 'build_app', { request });
currentTask.resolve({ result });
```
