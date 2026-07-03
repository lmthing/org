---
id: finalize
output:
  appId: string
  tables: array
  pages: array
  endpoints: array
  hooks: array
  ok: boolean
dependsOn: [create_project, build_table, build_api, build_page, build_hook]
goal: true
role: general
---

Package the build result for the caller. This is the GOAL task — it ALWAYS runs and ALWAYS
resolves a uniform summary of what was built. Upstream arrays arrive by task id: `build_table`
({ name, ok }[]), `build_api` ({ route, ok }[]), `build_page` ({ route, ok }[]), `build_hook`
({ slug, ok }[]); `create_project` is { appId, root, ok }. Keep only the pieces that were written
ok. Emit:

const tables = (Array.isArray(build_table) ? build_table : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const endpoints = (Array.isArray(build_api) ? build_api : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const pages = (Array.isArray(build_page) ? build_page : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const hooks = (Array.isArray(build_hook) ? build_hook : []).filter((x: { ok: boolean }) => x.ok).map((x: { slug: string }) => x.slug);
currentTask.resolve({ appId: create_project.appId, tables, pages, endpoints, hooks, ok: create_project.ok === true });
