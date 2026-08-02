/**
 * W9 — the SLICE PLAN. HOST-RUN, deterministic: groups the already-validated design
 * (`plan_tables`/`plan_endpoints`/`plan_view_components`/`plan_views`/`plan_automations`) into an
 * ORDERED array of self-contained vertical slices, each `{ model Δ → queries → views → gates →
 * promote }` (§8). This is grouping, not redesign — nothing here invents a table, an endpoint or a
 * page; it only decides the ORDER they land in and which artifacts travel together.
 *
 * **The spine guarantee.** Slice 0 is whichever page(s) need only tables with NO foreign-key
 * dependency on another table still unplanned at that point — typically one entity's list + create,
 * exactly the "shell + index + one entity list + create" example in §8. Every later slice only adds
 * tables/endpoints/views that are safe given everything an EARLIER slice already promoted, so
 * `implement_slice` can gate and serve the app after ANY slice without touching a table, endpoint or
 * page from a later one. That is what makes "openable and green after slice 0, and after every
 * promotion" true by CONSTRUCTION rather than by hoping the build finishes.
 *
 * **Ordering, precisely:**
 *   1. Tables are topologically sorted on their FK `references` (a table depending on another can
 *      never be assigned before it) — a cycle degrades to declaration order for the tied set (fail
 *      soft: this is a grouping convenience, not the FK integrity check itself, which
 *      `writeProjectTable`/SQLite already own).
 *   2. Each ENDPOINT's depth is the deepest depth of any table it touches (0 if it touches none).
 *   3. Each PAGE's depth is the deepest depth of any endpoint it declares (`plan_views[i].endpoints`
 *      already names them — no section-walking needed). A page naming no endpoint is depth 0.
 *   4. Pages are grouped into consecutive slices by ASCENDING depth (ties in the same slice); each
 *      slice's `tables`/`endpoints`/`components`/`automations` are the full objects newly required by
 *      its pages that no EARLIER slice already carries (cumulative "seen" sets, not depth-number
 *      arithmetic — correct even where the depth sequence has gaps).
 *   5. An automation is assigned to the slice that introduces the table it reacts to
 *      (`on.table`/`reads`/`writes`); one naming no table (pure-cron, or unresolvable) rides on the
 *      FINAL slice — the safest default, since every table it might reference already exists there.
 *
 * A slice with no pages at all (every endpoint/table exists but nothing reads it, or `plan_views` is
 * empty) still gets ONE slice carrying every remaining table/endpoint/component/automation, so
 * nothing planned is silently dropped from the slice list — `implement_slice` still authors it, just
 * with no page to gate against yet.
 */

interface ColumnRef {
  table?: string;
}
interface ColumnSpec {
  type?: string;
  description?: string;
  references?: ColumnRef;
}
interface TableSpec {
  name?: string;
  schema?: { columns?: Record<string, ColumnSpec> };
  rows?: unknown[];
}
interface EndpointSpec {
  name?: string;
  route?: string;
  tables?: string[];
}
interface ComponentSpec {
  name?: string;
}
interface PageSpec {
  route?: string;
  endpoints?: string[];
  components?: string[];
}
interface AutomationSpec {
  slug?: string;
  on?: { table?: string };
  reads?: string[];
  writes?: string[];
}

export interface Slice {
  id: string;
  tables: TableSpec[];
  endpoints: EndpointSpec[];
  components: ComponentSpec[];
  automations: AutomationSpec[];
  views: PageSpec[];
}

interface Ctx {
  [k: string]: unknown;
}

export const node = {
  id: 'plan_slices',
  dependsOn: ['plan_tables', 'plan_endpoints', 'plan_view_components', 'plan_views', 'plan_automations'],
  output: {
    slices: 'array',
    sliceCount: 'number',
  },
};

/** Topologically order tables on FK `references` — a table's depth is 1 + the deepest depth of any
 *  table it references (0 for a table with no FK, or one whose target is not itself in the plan). A
 *  cycle (should not happen post-`validate_contract`, but this node degrades rather than throws) falls
 *  back to declaration order for the tied members, so slicing still terminates. */
function tableDepths(tables: TableSpec[]): Map<string, number> {
  const names = tables.map((t) => t.name ?? '').filter(Boolean);
  const nameSet = new Set(names);
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const name = t.name ?? '';
    if (!name) continue;
    const refs = new Set<string>();
    for (const col of Object.values(t.schema?.columns ?? {})) {
      const target = col.references?.table;
      if (target && nameSet.has(target) && target !== name) refs.add(target);
    }
    deps.set(name, refs);
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  function resolve(name: string): number {
    const cached = depth.get(name);
    if (cached !== undefined) return cached;
    if (visiting.has(name)) return 0; // cycle guard — degrade to 0 for this member, not a throw
    visiting.add(name);
    let d = 0;
    for (const dep of deps.get(name) ?? []) d = Math.max(d, resolve(dep) + 1);
    visiting.delete(name);
    depth.set(name, d);
    return d;
  }
  for (const name of names) resolve(name);
  return depth;
}

/** Deepest table depth an endpoint touches (0 if it touches none/unresolvable tables). */
function endpointDepth(ep: EndpointSpec, tDepth: Map<string, number>): number {
  let d = 0;
  for (const t of ep.tables ?? []) d = Math.max(d, tDepth.get(t) ?? 0);
  return d;
}

/**
 * Group the design into ordered, self-contained slices. Pure function of the five upstream plan
 * arrays — no host/IO, so it is unit-testable without a fork or a project on disk.
 */
export function planSlices(
  tables: TableSpec[],
  endpoints: EndpointSpec[],
  components: ComponentSpec[],
  views: PageSpec[],
  automations: AutomationSpec[],
): Slice[] {
  const tDepth = tableDepths(tables);
  const tableByName = new Map(tables.map((t) => [t.name ?? '', t]));
  const endpointByName = new Map(endpoints.map((e) => [e.name ?? '', e]));
  const componentByName = new Map(components.map((c) => [c.name ?? '', c]));

  const eDepth = new Map<string, number>();
  for (const ep of endpoints) eDepth.set(ep.name ?? '', endpointDepth(ep, tDepth));

  const pageDepth = (p: PageSpec): number => {
    let d = 0;
    for (const epName of p.endpoints ?? []) d = Math.max(d, eDepth.get(epName) ?? 0);
    return d;
  };

  // Bucket pages by depth, then sort buckets ascending — consecutive slice indices even if the
  // depth sequence has gaps (e.g. depths 0, 2 with nothing at 1 still yields exactly two slices).
  const byDepth = new Map<number, PageSpec[]>();
  for (const p of views) {
    const d = pageDepth(p);
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(p);
  }
  const orderedDepths = [...byDepth.keys()].sort((a, b) => a - b);

  const seenTables = new Set<string>();
  const seenEndpoints = new Set<string>();
  const seenComponents = new Set<string>();
  const seenAutomations = new Set<string>();
  const slices: Slice[] = [];

  const newlyRequiredTables = (page: PageSpec): TableSpec[] => {
    const out: TableSpec[] = [];
    for (const epName of page.endpoints ?? []) {
      for (const t of endpointByName.get(epName)?.tables ?? []) {
        if (seenTables.has(t)) continue;
        seenTables.add(t);
        const spec = tableByName.get(t);
        if (spec) out.push(spec);
      }
    }
    return out;
  };
  const newlyRequiredEndpoints = (page: PageSpec): EndpointSpec[] => {
    const out: EndpointSpec[] = [];
    for (const epName of page.endpoints ?? []) {
      if (seenEndpoints.has(epName)) continue;
      seenEndpoints.add(epName);
      const spec = endpointByName.get(epName);
      if (spec) out.push(spec);
    }
    return out;
  };
  const newlyRequiredComponents = (page: PageSpec): ComponentSpec[] => {
    const out: ComponentSpec[] = [];
    for (const cName of page.components ?? []) {
      if (seenComponents.has(cName)) continue;
      seenComponents.add(cName);
      const spec = componentByName.get(cName);
      if (spec) out.push(spec);
    }
    return out;
  };

  for (const d of orderedDepths) {
    const pages = byDepth.get(d)!;
    const sliceTables: TableSpec[] = [];
    const sliceEndpoints: EndpointSpec[] = [];
    const sliceComponents: ComponentSpec[] = [];
    for (const p of pages) {
      sliceTables.push(...newlyRequiredTables(p));
      sliceEndpoints.push(...newlyRequiredEndpoints(p));
      sliceComponents.push(...newlyRequiredComponents(p));
    }
    slices.push({
      id: `slice-${slices.length}`,
      tables: sliceTables,
      endpoints: sliceEndpoints,
      components: sliceComponents,
      automations: [], // assigned below, once every slice's table set is known
      views: pages,
    });
  }

  // A table/endpoint/component that exists in the plan but is reached by NO page (dead-planned, or
  // `plan_views` came back empty) still needs a home — append one trailing slice for the remainder
  // rather than silently dropping it from the slice list.
  const leftoverTables = tables.filter((t) => t.name && !seenTables.has(t.name));
  const leftoverEndpoints = endpoints.filter((e) => e.name && !seenEndpoints.has(e.name));
  const leftoverComponents = components.filter((c) => c.name && !seenComponents.has(c.name));
  if (leftoverTables.length || leftoverEndpoints.length || leftoverComponents.length) {
    slices.push({
      id: `slice-${slices.length}`,
      tables: leftoverTables,
      endpoints: leftoverEndpoints,
      components: leftoverComponents,
      automations: [],
      views: [],
    });
  }

  // No pages at all (e.g. an api-only build): one slice carrying everything planned.
  if (slices.length === 0 && (tables.length || endpoints.length)) {
    slices.push({ id: 'slice-0', tables, endpoints, components, automations: [], views: [] });
    for (const t of tables) if (t.name) seenTables.add(t.name);
  }

  // Assign automations: the EARLIEST slice whose tables cover the automation's referenced table(s);
  // no resolvable table (pure-cron, or references one outside the plan) rides the LAST slice.
  const sliceIndexOfTable = new Map<string, number>();
  slices.forEach((s, i) => {
    for (const t of s.tables) if (t.name) sliceIndexOfTable.set(t.name, i);
  });
  const lastIndex = Math.max(0, slices.length - 1);
  for (const a of automations) {
    const refs = [a.on?.table, ...(a.reads ?? []), ...(a.writes ?? [])].filter(Boolean) as string[];
    let idx = -1;
    for (const r of refs) {
      const si = sliceIndexOfTable.get(r);
      if (si !== undefined) idx = idx === -1 ? si : Math.max(idx, si);
    }
    slices[idx === -1 ? lastIndex : idx]?.automations.push(a);
  }

  return slices;
}

export async function run(_ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tables = Array.isArray(inputs.plan_tables && (inputs.plan_tables as { tables?: unknown }).tables)
    ? ((inputs.plan_tables as { tables: TableSpec[] }).tables)
    : [];
  const endpoints = Array.isArray((inputs.plan_endpoints as { endpoints?: unknown })?.endpoints)
    ? ((inputs.plan_endpoints as { endpoints: EndpointSpec[] }).endpoints)
    : [];
  const components = Array.isArray((inputs.plan_view_components as { components?: unknown })?.components)
    ? ((inputs.plan_view_components as { components: ComponentSpec[] }).components)
    : [];
  // `plan_views` is itself a forEach node's collected output — a bare array of page results.
  const views = Array.isArray(inputs.plan_views) ? (inputs.plan_views as PageSpec[]) : [];
  const automations = Array.isArray((inputs.plan_automations as { automations?: unknown })?.automations)
    ? ((inputs.plan_automations as { automations: AutomationSpec[] }).automations)
    : [];

  const slices = planSlices(tables, endpoints, components, views, automations);
  return { slices, sliceCount: slices.length };
}
