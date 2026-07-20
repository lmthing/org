/**
 * The contract gate — HOST-RUN, and it runs BEFORE a single line of app code exists.
 *
 * `plan_tables` + `plan_endpoints` + `plan_components` + `plan_pages` are four independent model
 * turns. Nothing made them agree. In 06-tanzania run 32 the Costs page called
 * `useApi('costs-summary')` — a name `plan_endpoints` never assigned — and the page shipped dead:
 * the client rejects an unknown name BEFORE issuing a request, so there was an error state and
 * nothing in the network panel. That fault was authored at PLAN time and only surfaced after every
 * table, endpoint, component and page had been written.
 *
 * This node cross-checks the whole graph while it is still cheap to fix, and its `onFail` resumes
 * `plan_tables` carrying `errors` — so the redesign is TOLD which references broke rather than
 * re-running blind and reproducing them. Each message names the offending node and the offending
 * reference, because that text is the entire input the resumed design node receives.
 *
 * It reports; it never throws on a finding (a code node has no salvage path — a throw fails the
 * whole node and aborts the tasklist), and it emits a SCALAR `ok` because the condition DSL's
 * `getAtPath` returns `undefined` for arrays, so `validate_contract.errors.length > 0` is not
 * expressible in a `when:`.
 */

export const node = {
  id: 'validate_contract',
  dependsOn: ['plan_tables', 'plan_endpoints', 'plan_components', 'plan_pages', 'plan_automations'],
  output: {
    ok: 'boolean',
    errorCount: 'number',
    errors: 'array',
  },
  // Resume the DESIGN, not the implementation — nothing has been written yet. `carry: errors` is the
  // point: `getUpstreamOutputs` only passes `dependsOn`, and the resumed node cannot depend on its
  // own checker without creating a cycle, so the reasons ride in on the seed as `feedback` instead.
  // Without it the design nodes re-run blind and reproduce the same mistake.
  onFail: {
    goto: 'plan_tables',
    when: 'validate_contract.ok == false',
    carry: 'errors',
    maxAttempts: 2,
  },
};

interface TableSpec {
  name?: string;
}
interface EndpointSpec {
  name?: string;
  route?: string;
  tables?: string[];
  fields?: string[];
}
interface ComponentSpec {
  name?: string;
  props?: string[];
}
interface PageSpec {
  route?: string;
  endpoints?: string[];
  components?: string[];
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

export async function run(_ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tables = list<TableSpec>((inputs['plan_tables'] as { tables?: unknown } | undefined)?.tables);
  const endpoints = list<EndpointSpec>((inputs['plan_endpoints'] as { endpoints?: unknown } | undefined)?.endpoints);
  const components = list<ComponentSpec>(
    (inputs['plan_components'] as { components?: unknown } | undefined)?.components,
  );
  // `plan_pages` is a per-page forEach, so its output is already an ARRAY of page specs.
  const pages = list<PageSpec>(inputs['plan_pages']);
  const automations = list<AutomationSpec>(
    (inputs['plan_automations'] as { automations?: unknown } | undefined)?.automations,
  );

  const errors: Array<{ node: string; ref: string; message: string }> = [];
  const add = (n: string, ref: string, message: string): void => {
    errors.push({ node: n, ref, message });
  };

  const tableNames = new Set(tables.map((t) => String(t.name ?? '')).filter(Boolean));
  const endpointNames = new Set(endpoints.map((e) => String(e.name ?? '')).filter(Boolean));
  const componentNames = new Set(components.map((c) => String(c.name ?? '')).filter(Boolean));
  const knownEndpoints = [...endpointNames].join(', ') || 'none';
  const knownComponents = [...componentNames].join(', ') || 'none';
  const knownTables = [...tableNames].join(', ') || 'none';

  // (1) Duplicate endpoint names / routes. `name` is what a page passes to useApi and what the
  // module exports; two endpoints sharing one means whichever loads second silently wins.
  const seenName = new Set<string>();
  const seenRoute = new Set<string>();
  for (const e of endpoints) {
    const n = String(e.name ?? '');
    const r = String(e.route ?? '');
    if (!n) {
      add('plan_endpoints', '(unnamed)', 'an endpoint has no `name` — `name` is what pages pass to useApi() and what the module exports; every endpoint needs a unique one');
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

  // NOTE — there is deliberately NO "endpoint field must be a real column" check. It was here and
  // removed after run 35: a single-table GROUP BY / aggregate legitimately computes fields no column
  // carries (`costs-summary` on `costs`), so the check fired on correct designs, and the model began
  // dismissing the WHOLE feedback channel as noise. The one real case it caught — a re-cased field
  // (`amountUSD` for `amount_usd`) — is now a COMPILE error via the `emit_types` contract (a page
  // reading the wrong key does not typecheck), and a field the handler never actually returns is
  // caught at runtime by `smoke_endpoints`. Both downstream mechanisms are precise; this one was not.

  // (4) A page naming an endpoint nobody assigned — the run-32 dead-page fault, caught at plan time.
  for (const p of pages) {
    for (const ref of list<string>(p.endpoints)) {
      if (endpointNames.has(String(ref))) continue;
      add('plan_pages', String(ref), `page "${p.route}" reads endpoint "${ref}" which plan_endpoints never declares (have: ${knownEndpoints}) — the client rejects an unknown name before issuing any request, so the page renders an error state with nothing in the network panel`);
    }
    for (const ref of list<string>(p.components)) {
      if (componentNames.has(String(ref))) continue;
      add('plan_pages', String(ref), `page "${p.route}" renders component "${ref}" which plan_components never declares (have: ${knownComponents}) — a dangling import fails the whole bundle`);
    }
  }

  // (5) A parameterized route with no caller able to supply its param. The missing value is
  // stringified into the path ("/api/.../undefined"), which still matches and passes validation,
  // so it returns a plausible 200 carrying the wrong row.
  for (const e of endpoints) {
    const params = routeParams(String(e.route ?? ''));
    if (params.length === 0) continue;
    const called = pages.some((p) => list<string>(p.endpoints).includes(String(e.name)));
    if (called) continue;
    add('plan_endpoints', String(e.name), `endpoint "${e.name}" takes ${params.map((x) => `[${x}]`).join('')} but no page declares it — either a page must read it (and supply the param) or it should not be in the contract`);
  }

  // (6) A component whose props no page-visible endpoint can feed. Props are the contract between a
  // page and a component; one nothing supplies renders permanently blank.
  for (const c of components) {
    const used = pages.some((p) => list<string>(p.components).includes(String(c.name)));
    if (!used) {
      add('plan_components', String(c.name), `component "${c.name}" is declared but no page renders it — drop it, or have a page use it`);
    }
    // There is deliberately NO "every prop must be an endpoint field" check. A prop is a contract
    // between the PAGE and the component, not between the component and an endpoint: a page passes
    // literals (`label="Pending"`), values it derives client-side, or endpoint fields, and at plan
    // time "fed a literal" is indistinguishable from "fed nothing". The version that flagged this
    // (run 35) fired on every static `title`/`subtitle`/`message`/`label`, inflating the error list
    // until the model dismissed real errors alongside the false ones. A prop actually fed nothing
    // surfaces where it is real — an empty render — not as a plan-time guess.
  }

  // (7) A table nothing reads is dead weight the app will never show.
  for (const name of tableNames) {
    const read = endpoints.some((e) => list<string>(e.tables).includes(name));
    if (read) continue;
    add('plan_tables', name, `table "${name}" is declared but no endpoint reads it — nothing in the app can ever show it. Add an endpoint, or drop the table.`);
  }

  // (8) AUTOMATIONS — a cron/event hook is authored ONLY when a user story needs it, and MOST apps
  // plan none (an empty list is the correct common case, so this loop simply runs zero times). When
  // one IS planned, every table it reads/writes/reacts-to must be a table `plan_tables` declares: a
  // handler querying a table that never landed builds clean and 500s at runtime, and an event hook
  // subscribed to `project/db.<missingTable>.<event>` never fires — a dangling trigger. This is the
  // same class of fault as an endpoint reading a missing table (check 2), routed to the same redesign.
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
