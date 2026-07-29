/**
 * The contract gate — HOST-RUN, and it runs BEFORE a single line of app code exists.
 *
 * `plan_tables` + `plan_endpoints` + `plan_view_components` + `plan_views` are four independent model
 * turns. Nothing made them agree. This node cross-checks the whole graph while it is still cheap to
 * fix, and its `onFail` resumes `plan_tables` carrying `errors` — so the redesign is TOLD which
 * references broke rather than re-running blind and reproducing them. Each message names the offending
 * node and the offending reference, because that text is the entire input the resumed design node
 * receives, and it NAMES THE REAL OPTIONS (the endpoints that exist, the fields that exist) rather
 * than only saying "invalid".
 *
 * **What is different from the appbuilder's copy of this gate.** A page here is a SPEC — an ordered
 * list of sections, each naming ONE endpoint and binding `$.field` paths straight into its Output.
 * There is no client-side glue: no `.map`, no join across two responses, no ternary. So a binding the
 * endpoint does not declare is not a cosmetic mismatch, it is a value that can never appear on the
 * page, and it is unfixable downstream — `implement_views` has nowhere to put the missing computation.
 * That is the **view-shaped-endpoint rule**, and checks (V2)/(V3) below are it: every section's FULL
 * binding set must be satisfiable by its ONE endpoint's declared Output, and a miss is routed to
 * `plan_endpoints` — the endpoint grows a computed field; the page never grows glue.
 *
 * It reports; it never throws on a finding (a code node has no salvage path — a throw fails the whole
 * node and aborts the tasklist), and it emits a SCALAR `ok` because the condition DSL's `getAtPath`
 * returns `undefined` for arrays, so `validate_contract.errors.length > 0` is not expressible in a
 * `when:`.
 */

export const node = {
  id: 'validate_contract',
  dependsOn: ['plan_tables', 'plan_endpoints', 'plan_view_components', 'plan_views', 'plan_automations'],
  output: {
    ok: 'boolean',
    errorCount: 'number',
    errors: 'array',
  },
  // Resume the DESIGN, not the implementation — nothing has been written yet. `carry: errors` is the
  // point: `getUpstreamOutputs` only passes `dependsOn`, and the resumed node cannot depend on its
  // own checker without creating a cycle, so the reasons ride in on the seed as `feedback` instead.
  onFail: {
    goto: 'plan_tables',
    when: 'validate_contract.ok == false',
    carry: 'errors',
    maxAttempts: 2,
  },
};

interface ColumnSpec {
  type?: string;
  description?: string;
}
interface TableSpec {
  name?: string;
  schema?: { columns?: Record<string, ColumnSpec> };
}
interface EndpointSpec {
  name?: string;
  route?: string;
  tables?: string[];
  fields?: unknown[];
}
interface ComponentSpec {
  name?: string;
  props?: string[];
}
interface SectionSpec {
  id?: string;
  kind?: string;
  endpoint?: string;
  from?: string;
  component?: string;
  reveals?: string[];
  bindings?: string[];
}
interface PageSpec {
  route?: string;
  endpoints?: string[];
  components?: string[];
  sections?: SectionSpec[];
}
interface AutomationSpec {
  slug?: string;
  story?: string;
  kind?: string;
  run?: string;
  every?: string;
  daily?: string;
  on?: { table?: string; event?: string };
  reads?: string[];
  writes?: string[];
  trigger?: string;
}

interface Ctx {
  [k: string]: unknown;
}

/** `'total_usd: number'` → `'total_usd'`; a bare `'total_usd'` is returned unchanged. */
function fieldName(entry: string): string {
  return String(entry).split(':')[0]!.trim();
}

/**
 * The declared key names of one endpoint's response item. `05-plan_endpoints` allows TWO shapes per
 * entry — a `'key: type'` string for a scalar, and a `{ name, list?, nullable?, item: [...] }` object
 * for a LIST or RECORD field — and a binding may legitimately name either.
 */
function endpointFieldNames(e: EndpointSpec): Set<string> {
  const out = new Set<string>();
  for (const raw of Array.isArray(e.fields) ? e.fields : []) {
    if (typeof raw === 'string') {
      const n = fieldName(raw);
      if (n) out.add(n);
      continue;
    }
    if (raw && typeof raw === 'object') {
      const n = String((raw as { name?: unknown }).name ?? '').trim();
      if (n) out.add(n);
    }
  }
  return out;
}

/**
 * The FIRST path segment of a `$.`-rooted binding — the only part this gate can check against a plan.
 * `'$.paid_by_name'` → `'paid_by_name'`; `'$.plan.days'` → `'plan'` (the endpoint declares `plan` with
 * a nested `item` shape, and the sub-keys inside it are the emitted contract's business, not this
 * node's). Returns `''` for a binding rooted anywhere else (`$props.`, `$route.`, `$data.`, `$result.`,
 * `$form.`, `$client.timezone`, bare `$`) — those resolve outside the endpoint's Output.
 */
function ownFieldOfBinding(binding: string): string {
  const s = String(binding).trim();
  if (!s.startsWith('$.')) return '';
  const seg = s.slice(2).split('.')[0] ?? '';
  return seg.replace(/\[\d+\]$/, '');
}

/** The `[param]` segments a route declares, e.g. `bookings/[id]/PATCH` → `['id']`. */
function routeParams(route: string): string[] {
  const out: string[] = [];
  for (const seg of String(route).split('/')) {
    const m = /^\[([A-Za-z0-9_]+)\]$/.exec(seg);
    if (m) out.push(m[1] as string);
  }
  return out;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The ONLY column `type`s the write-time schema validator accepts — mirrors
 *  `libs/core/src/db/validate.ts#COLUMN_TYPES` exactly. Anything else — a TS union
 *  (`'string | null'`) or an array shape (`'string[]'`) — throws `unknown column type` at write time
 *  and the WHOLE table silently fails to land. */
const BASE_COLUMN_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'date', 'json']);

/**
 * The eight section kinds, verbatim from `libs/cli/src/app/view-spec/schema.ts#SECTION_KINDS`. The
 * union is FULL and capped — a ninth kind is a plan change decided by the improvement-loop ratchet,
 * never something a planner may mint. Catching an invented kind HERE, with the real menu named, is
 * far cheaper than catching it at `writeProjectView` time on every page that used it.
 */
const SECTION_KINDS: ReadonlySet<string> = new Set([
  'list',
  'detail',
  'create',
  'stats',
  'markdown',
  'chat',
  'toolbar',
  'timeline',
]);

/** Kinds that do not necessarily read an endpoint. Everything else must name one. */
const ENDPOINTLESS_KINDS: ReadonlySet<string> = new Set(['toolbar', 'chat', 'markdown']);

export async function run(_ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tables = list<TableSpec>((inputs['plan_tables'] as { tables?: unknown } | undefined)?.tables);
  const endpoints = list<EndpointSpec>((inputs['plan_endpoints'] as { endpoints?: unknown } | undefined)?.endpoints);
  const components = list<ComponentSpec>(
    (inputs['plan_view_components'] as { components?: unknown } | undefined)?.components,
  );
  // `plan_views` is a per-page forEach, so its output is already an ARRAY of page specs.
  const pages = list<PageSpec>(inputs['plan_views']);
  const automations = list<AutomationSpec>(
    (inputs['plan_automations'] as { automations?: unknown } | undefined)?.automations,
  );

  const errors: Array<{ node: string; ref: string; message: string }> = [];
  const add = (n: string, ref: string, message: string): void => {
    errors.push({ node: n, ref, message });
  };

  const tableNames = new Set(tables.map((t) => String(t.name ?? '')).filter(Boolean));
  const endpointByName = new Map<string, EndpointSpec>();
  for (const e of endpoints) {
    const n = String(e.name ?? '');
    if (n && !endpointByName.has(n)) endpointByName.set(n, e);
  }
  const endpointNames = new Set(endpointByName.keys());
  const componentNames = new Set(components.map((c) => String(c.name ?? '')).filter(Boolean));
  const knownEndpoints = [...endpointNames].join(', ') || 'none';
  const knownComponents = [...componentNames].join(', ') || 'none';
  const knownTables = [...tableNames].join(', ') || 'none';

  // (0) A planned column `type` outside the five base kinds `writeProjectTable` accepts. The
  // write-time validator exact-matches and THROWS, silently failing the whole table (no rows, no
  // schema) with no log line — so `implement_tables` keeps "succeeding" against a table that was
  // never on disk. Caught HERE, at plan time.
  for (const t of tables) {
    const tableName = String(t.name ?? '(unnamed)');
    const columns = t.schema?.columns;
    if (!columns || typeof columns !== 'object') continue;
    for (const [columnName, col] of Object.entries(columns)) {
      const type = String(col?.type ?? '');
      if (BASE_COLUMN_TYPES.has(type)) continue;
      add(
        'plan_tables',
        `${tableName}.${columnName}`,
        `table "${tableName}" column "${columnName}" has type "${type}" — a column \`type\` must be ` +
          `exactly one of string|number|boolean|date|json (never a TypeScript union or an array shape). ` +
          `Use a base type and, if the value may be absent or empty, set \`required: false\` (or omit ` +
          `\`required\`) — nullability is a flag, never encoded in \`type\`.`,
      );
    }
  }

  // (1) Duplicate endpoint names / routes. `name` is what a section's `query`/`mutation` resolves
  // against and what the module exports; two endpoints sharing one means whichever loads second wins.
  const seenName = new Set<string>();
  const seenRoute = new Set<string>();
  for (const e of endpoints) {
    const n = String(e.name ?? '');
    const r = String(e.route ?? '');
    if (!n) {
      add('plan_endpoints', '(unnamed)', 'an endpoint has no `name` — `name` is what a section names in `query`/`mutation` and what the module exports; every endpoint needs a unique one');
    } else if (seenName.has(n)) {
      add('plan_endpoints', n, `two endpoints share the name "${n}" — names are unique per project; whichever module loads second silently wins. Rename one.`);
    }
    seenName.add(n);
    if (r && seenRoute.has(r)) {
      add('plan_endpoints', r, `two endpoints share the route "${r}" — one file path can hold one handler. Give one of them a different route.`);
    }
    seenRoute.add(r);
  }

  // (2) An endpoint declaring a table that was never planned. The db surface is dynamically typed,
  // so this builds CLEAN and 500s on every call.
  for (const e of endpoints) {
    for (const t of list<string>(e.tables)) {
      if (tableNames.has(String(t))) continue;
      add('plan_endpoints', String(t), `endpoint "${e.name}" reads table "${t}" which plan_tables never declares (have: ${knownTables}) — the handler would build clean and 500 on every call`);
    }
  }

  // ── the VIEW checks (V1–V6) ────────────────────────────────────────────────────────────────────
  //
  // These are what makes this gate different from the appbuilder's. A spec page has no client code,
  // so each of these is a value that could never appear rather than a mismatch someone patches later.

  for (const p of pages) {
    const route = String(p.route ?? '(unrouted)');
    const sections = list<SectionSpec>(p.sections);

    if (sections.length === 0) {
      add('plan_views', route, `page "${route}" plans no sections — a page IS its section list, so this route would render an empty shell. Give it at least one section (a \`list\` over the endpoint that serves this page's story is the usual answer).`);
    }

    // (V1) Section ids: present where they are referenced, and unique on the page. `id` is the handle
    // for `reveals` and for `$data.<id>.…`, so a duplicate silently redirects one of them.
    const idsOnPage = new Set<string>();
    for (const s of sections) {
      const id = String(s.id ?? '');
      if (!id) continue;
      if (idsOnPage.has(id)) {
        add('plan_views', `${route}#${id}`, `page "${route}" has two sections with id "${id}" — an id is the handle a \`reveals\` target and a \`$data.${id}.…\` binding resolve against, so a duplicate silently points at whichever came first. Rename one.`);
      }
      idsOnPage.add(id);
    }

    for (const s of sections) {
      const id = String(s.id ?? '(unnamed section)');
      const ref = `${route}#${id}`;
      const kind = String(s.kind ?? '');

      // (V2) The kind must be one of the eight. The union is capped; there is no `custom`.
      if (!SECTION_KINDS.has(kind)) {
        add('plan_views', ref, `section "${id}" on page "${route}" has kind "${kind}" — that is not a section kind. The complete menu is: ${[...SECTION_KINDS].join(', ')}. There is no ninth kind and no custom escape: if none of the eight expresses this surface, drop the section and record it in this page's \`cannotExpress\` instead of forcing it into the nearest kind.`);
      }

      // (V3) The endpoint must exist. A section naming an endpoint nobody assigned is a dead section:
      // `writeProjectView` rejects the name, so the page never lands at all.
      const endpointName = String(s.endpoint ?? '');
      if (!endpointName) {
        if (!ENDPOINTLESS_KINDS.has(kind) && !String(s.from ?? '').startsWith('$data.')) {
          add('plan_views', ref, `section "${id}" on page "${route}" is a \`${kind}\` but names no endpoint — a ${kind} section reads exactly one. Name one of: ${knownEndpoints} (or source it from another section's Output with \`from: '$data.<sectionId>.<path>'\`).`);
        }
      } else if (!endpointNames.has(endpointName)) {
        add('plan_views', endpointName, `section "${id}" on page "${route}" reads endpoint "${endpointName}" which plan_endpoints never declares (have: ${knownEndpoints}) — the writer rejects an unknown endpoint name, so this whole page fails to save`);
      }

      // (V4) THE VIEW-SHAPED-ENDPOINT RULE. Every `$.`-rooted binding this section shows must be a
      // field of its ONE endpoint. The fix is ALWAYS at the endpoint: a spec page has no `.map`, no
      // join and no ternary, so a value the endpoint does not return has nowhere to come from. This
      // error is deliberately addressed to `plan_endpoints`.
      const ep = endpointName ? endpointByName.get(endpointName) : undefined;
      if (ep) {
        const declared = endpointFieldNames(ep);
        const have = [...declared].join(', ') || 'none';
        const checked = [...list<string>(s.bindings), String(s.from ?? '')].filter(Boolean);
        const flagged = new Set<string>();
        for (const b of checked) {
          const own = ownFieldOfBinding(b);
          if (!own || declared.has(own) || flagged.has(own)) continue;
          flagged.add(own);
          add(
            'plan_endpoints',
            `${endpointName}.${own}`,
            `page "${route}" section "${id}" binds "${b}", but endpoint "${endpointName}" does not declare a field "${own}" (it declares: ${have}). ` +
              `One section reads ONE endpoint and a spec page has no client code — no map, no join, no ternary — so this value has nowhere to come from. ` +
              `ADD "${own}" to "${endpointName}"'s \`fields\` as a COMPUTED field the handler produces (a cross-table name, a total, a group-by, a status label, a picked "current" record, a boolean the row's controls read). ` +
              `Do NOT instead point the section at a second endpoint, and do NOT drop the value the story needs.`,
          );
        }
      }

      // (V5) A `$data.<sectionId>.…` binding must name a section that exists ON THIS PAGE, and a
      // `reveals` target likewise. Both resolve within one page's spec; a miss is a dead reference the
      // renderer can only treat as null.
      for (const b of list<string>(s.bindings)) {
        const m = /^\$data\.([A-Za-z_][A-Za-z0-9_]*)\./.exec(String(b));
        if (!m) continue;
        const target = m[1] as string;
        if (idsOnPage.has(target)) continue;
        add('plan_views', `${ref} → ${target}`, `section "${id}" on page "${route}" binds "${b}", but this page has no section with id "${target}" (ids on this page: ${[...idsOnPage].join(', ') || 'none'}). A \`$data.<sectionId>\` binding reads ANOTHER SECTION OF THE SAME PAGE — give that section an \`id\`, or read the value from this section's own endpoint.`);
      }
      for (const target of list<string>(s.reveals)) {
        if (idsOnPage.has(String(target))) continue;
        add('plan_views', `${ref} → ${target}`, `section "${id}" on page "${route}" reveals "${target}", but this page has no section with that id (ids on this page: ${[...idsOnPage].join(', ') || 'none'}). A toolbar reveals sections of its OWN page: add the section it is meant to open (usually a hidden \`create\`), or drop the button.`);
      }

      // (V6) A component reference must resolve. `{ use: '<Name>' }` against an undeclared name is a
      // save-time rejection of the whole page.
      const comp = String(s.component ?? '');
      if (comp && !componentNames.has(comp)) {
        add('plan_views', comp, `page "${route}" section "${id}" uses view component "${comp}" which plan_view_components never declares (have: ${knownComponents}) — the writer rejects an unresolved \`{ use: … }\`, so the whole page fails to save. Reference a declared component, or use the flat item form ({ title, caption, badge, … }) instead.`);
      }
    }

    // The page-level endpoint/component lists are the page's own summary; keep them honest too.
    for (const refName of list<string>(p.endpoints)) {
      if (endpointNames.has(String(refName))) continue;
      add('plan_views', String(refName), `page "${route}" lists endpoint "${refName}" which plan_endpoints never declares (have: ${knownEndpoints})`);
    }
    for (const refName of list<string>(p.components)) {
      if (componentNames.has(String(refName))) continue;
      add('plan_views', String(refName), `page "${route}" lists view component "${refName}" which plan_view_components never declares (have: ${knownComponents})`);
    }
  }

  // (5) A parameterized route with no caller able to supply its param. The missing value is
  // stringified into the path ("/api/.../undefined"), which still matches and passes validation,
  // so it returns a plausible 200 carrying the wrong row.
  const sectionsOf = (p: PageSpec): SectionSpec[] => list<SectionSpec>(p.sections);
  const readsEndpoint = (name: string): boolean =>
    pages.some(
      (p) => list<string>(p.endpoints).includes(name) || sectionsOf(p).some((s) => String(s.endpoint ?? '') === name),
    );
  for (const e of endpoints) {
    const params = routeParams(String(e.route ?? ''));
    if (params.length === 0) continue;
    if (readsEndpoint(String(e.name))) continue;
    add('plan_endpoints', String(e.name), `endpoint "${e.name}" takes ${params.map((x) => `[${x}]`).join('')} but no page section declares it — either a section must read it (and supply the param) or it should not be in the contract`);
  }

  // (5b) An endpoint no section reads and no automation runs is dead weight — and worse,
  // `plan_acceptance` may "verify" it, greenlighting an endpoint the user never hits while the
  // section's real one is broken.
  for (const e of endpoints) {
    const name = String(e.name ?? '');
    if (!name) continue;
    const usedByAuto = automations.some((a) => String(a.run ?? '') === name);
    if (!readsEndpoint(name) && !usedByAuto) {
      add('plan_endpoints', name, `endpoint "${name}" is declared but no page section reads it and no automation runs it — drop it, or have a section use it. An unused endpoint is never seen and cannot be meaningfully acceptance-checked.`);
    }
  }

  // (6) A view component nothing references is dead weight the app will never show. There is
  // deliberately NO "every prop must be an endpoint field" check: a prop is the contract between the
  // USE SITE and the component (a literal is a legal argument), and at plan time "fed a literal" is
  // indistinguishable from "fed nothing". The version of that check in the appbuilder fired on every
  // static label until the model dismissed real errors alongside the false ones.
  for (const c of components) {
    const name = String(c.name ?? '');
    const used = pages.some(
      (p) => list<string>(p.components).includes(name) || sectionsOf(p).some((s) => String(s.component ?? '') === name),
    );
    if (!used) {
      add('plan_view_components', name, `view component "${name}" is declared but no page section uses it — drop it, or have a section use it as its item/header shape. Most rows need no component at all: the flat item form ({ title, caption, badge, value, … }) covers an ordinary row.`);
    }
  }

  // (7) A table nothing reads is dead weight the app will never show.
  for (const name of tableNames) {
    const read = endpoints.some((e) => list<string>(e.tables).includes(name));
    if (read) continue;
    add('plan_tables', name, `table "${name}" is declared but no endpoint reads it — nothing in the app can ever show it. Add an endpoint, or drop the table.`);
  }

  // (9) Two tables that hold the SAME real-world entity — duplicate tables make a retract non-atomic
  // (a delete removes the row from only one; the other lingers and any total double-counts).
  const colSet = (t: TableSpec): Set<string> =>
    new Set(Object.keys(t.schema?.columns ?? {}).filter((c) => c !== 'id'));
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = colSet(tables[i]!), b = colSet(tables[j]!);
      if (a.size < 3 || b.size < 3) continue;
      const shared = [...a].filter((c) => b.has(c)).length;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap >= 0.6) {
        const na = String(tables[i]!.name), nb = String(tables[j]!.name);
        add('plan_tables', `${na} ~ ${nb}`,
          `tables "${na}" and "${nb}" share ${Math.round(overlap * 100)}% of their columns — they model the same entity. ` +
          `Two tables for one thing means a later delete/retract removes the row from only one, and any total double-counts. ` +
          `Merge them into ONE canonical table (keep the superset of columns) and point every endpoint at it.`);
      }
    }
  }

  // (8) AUTOMATIONS — a cron/event hook is authored ONLY when a user story needs it, and MOST apps
  // plan none (an empty list is the correct common case, so this loop simply runs zero times). When
  // one IS planned, every table it reads/writes/reacts-to must be a table `plan_tables` declares.
  const WRITE_EVENTS = new Set(['insert', 'update', 'remove']);
  const seenSlug = new Set<string>();
  const refTable = (auto: AutomationSpec, table: unknown, role: string): void => {
    const t = String(table ?? '');
    if (!t || tableNames.has(t)) return;
    add(
      'plan_automations',
      t,
      `automation "${auto.slug}" ${role} table "${t}" which plan_tables never declares (have: ${knownTables}) ` +
        `— a hook that touches a table that never landed builds clean and 500s (or never fires) at runtime`,
    );
  };
  for (const a of automations) {
    const slug = String(a.slug ?? '');
    if (!slug) {
      add('plan_automations', '(unnamed)', 'an automation has no `slug` — the slug is its `hooks/<slug>.ts` filename; every automation needs a unique lowercase-hyphen one');
    } else if (seenSlug.has(slug)) {
      add('plan_automations', slug, `two automations share the slug "${slug}" — one file path can hold one hook. Rename one.`);
    }
    seenSlug.add(slug);

    const kind = String(a.kind ?? '');
    if (kind !== 'cron' && kind !== 'event') {
      add('plan_automations', slug || kind, `automation "${slug}" has kind "${kind}" — an app automation is 'cron' (a schedule) or 'event' (a database write). Pick one that a user story needs.`);
    }

    if (kind === 'cron') {
      const hasEvery = typeof a.every === 'string' && a.every.length > 0;
      const hasDaily = typeof a.daily === 'string' && a.daily.length > 0;
      if (hasEvery === hasDaily) {
        add('plan_automations', slug, `cron automation "${slug}" needs EXACTLY ONE cadence — set \`every\` ('7d' for weekly) OR \`daily\` ('HH:MM'), not both and not neither.`);
      }
    }
    if (kind === 'event') {
      const table = String(a.on?.table ?? '');
      const event = String(a.on?.event ?? '');
      if (!table || !WRITE_EVENTS.has(event)) {
        add('plan_automations', slug, `event automation "${slug}" needs \`on: { table, event }\` — a real table (from plan_tables) and an event of insert|update|remove (got table "${table}", event "${event}").`);
      }
      refTable(a, table, 'reacts to writes on');
    }

    if (String(a.run ?? 'handler') === 'agent') {
      const trigger = String(a.trigger ?? '');
      if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(#[A-Za-z0-9_-]+)?$/.test(trigger)) {
        add('plan_automations', slug, `agent automation "${slug}" needs a \`trigger\` naming a 'space/agent#action' to delegate to (got "${trigger}"). Use run:'handler' for deterministic code instead.`);
      }
    }

    for (const t of list<string>(a.reads)) refTable(a, t, 'reads');
    for (const t of list<string>(a.writes)) refTable(a, t, 'writes');
  }

  return { ok: errors.length === 0, errorCount: errors.length, errors };
}
