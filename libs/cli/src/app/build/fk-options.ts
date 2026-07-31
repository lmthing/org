/**
 * **Derived `x-options`** — the reason a foreign key in a generated form is a picker and
 * not a UUID text box.
 *
 * A `create` section declares no fields; they derive from the mutation endpoint's Input
 * JSON Schema (`../../../../ui/src/view/form.tsx#deriveFields`). "Where do this field's
 * options come from" therefore has exactly one home — an `x-options` annotation on that
 * same Input property (`../view-spec/schema.ts#XOptions`) — and until this module existed
 * the ONLY way to get one was for the model to hand-write an `@x-options` JSDoc tag on the
 * property.
 *
 * It never did, and it structurally could not:
 *
 *  - the pipeline TEACHES `export type Input = JobsCreateInput` — an alias to a global
 *    ambient declared in `types/contract.d.ts` (`system-appbuilder/tasklists/
 *    build_live_project/12-implement_endpoints.md`). A handler file has no Input
 *    **property** to hang a JSDoc tag on at all;
 *  - `types/contract.d.ts` is emitted by `09-emit_types.ts` from the plan, which has no
 *    notion of a form control.
 *
 * So the annotation is derived here instead, from the two things the project already
 * states in machine-readable form: which columns are foreign keys (`database/*.json`) and
 * which endpoints list the target table (the endpoint contracts). Deriving it means the
 * model cannot forget it — measured live in scenario 30 (`30-bike-workshop`), whose
 * "Book a new job" form asked a bike-shop owner to type two UUIDs while the app's own
 * `bikes-for-select` and `customers-for-select` endpoints sat unused.
 *
 * Three rules keep the derivation honest:
 *
 *  1. **A hand-written annotation always wins.** This only ever FILLS a gap.
 *  2. **Every choice is deterministic and total-ordered** — same project, same output. A
 *     "closest match" that depends on directory iteration order would make a form's
 *     controls change between builds.
 *  3. **An unresolvable FK is left alone, and reported.** A text box is wrong but it
 *     works; guessing an endpoint that returns the wrong rows is worse, and rejecting the
 *     handler would refuse code that runs correctly at runtime.
 */

import type { LoadedTable } from '@lmthing/core';
import { X_OPTIONS_KEYWORD, type XOptions } from '../view-spec/schema.js';
import type { EndpointContract, JsonSchema } from './schema.js';

/** What a derivation pass did — the material for a report or a test assertion. */
export interface DerivedFormOptions {
  /** One entry per Input property that gained an `x-options`. */
  applied: Array<{ endpoint: string; property: string; table: string; query: string }>;
  /**
   * One entry per Input property recognised as a foreign key for which NO list endpoint
   * could be identified. Carries the finite candidate set so a caller can phrase a
   * menu-shaped message rather than "something is wrong".
   */
  unresolved: Array<{ endpoint: string; property: string; table: string; candidates: string[] }>;
}

/** Methods whose Input is a FORM. A GET's input is a facet/param map, never a create form. */
const FORM_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Label properties preferred in order when an options row offers several strings.
 * `label` first because a purpose-built `*-for-select` endpoint computes exactly that.
 */
const LABEL_PREFERENCE = ['label', 'name', 'title', 'display_name', 'displayName', 'full_name', 'fullName'];

/** Words that mark an endpoint as PURPOSE-BUILT for a picker — ranked above a full list. */
const SELECTISH = ['select', 'options', 'picker', 'choices', 'lookup'];

// ── name normalisation ───────────────────────────────────────────────────────

/**
 * Singularize the way `./schema.ts#tableInterfaceName` does (`categories` → `category`,
 * `boxes` → `box`, `items` → `item`, but `status`/`address`/`axis` untouched). Duplicated
 * rather than imported because that one is private to the row-type renderer and this
 * module must not force it public — the two agreeing is asserted by `fk-options.test.ts`.
 */
function singular(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/[^sui]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** A table/column word reduced to its comparable core: lowercase, unpunctuated, singular. */
function norm(word: string): string {
  return singular(word.replace(/[_\-\s]+/g, '').toLowerCase());
}

/** The `<base>` of an id-shaped column name — `bike_id`/`bikeId`/`bike-id` ⇒ `bike`. */
function idColumnBase(column: string): string | undefined {
  const m = /^(.+?)[_-]?(?:id|Id|ID)$/.exec(column);
  const base = m?.[1];
  return base && base.length > 0 ? base : undefined;
}

// ── which columns are foreign keys ───────────────────────────────────────────

/**
 * `column name → target table`, over the WHOLE project rather than per table.
 *
 * Keyed by name because an endpoint's Input is not a table: scenario 30's `jobs-create`
 * takes a `customer_id` the `jobs` table does not even have (it narrows the bike picker),
 * and a per-table lookup would have skipped exactly the field the shop owner had to type a
 * UUID into. The cost is that one name must mean one thing project-wide — so when two
 * tables disagree about a column name's target, the name is dropped rather than guessed.
 *
 * Three sources, in decreasing authority:
 *  1. `column.references.table` — the declared SQLite foreign key;
 *  2. a `belongsTo` relation whose `via` is this column;
 *  3. the `<table>_id` naming convention, accepted only when exactly one table matches.
 *
 * (3) exists because it is what apps actually ship: 4 of 4 tables in scenario 30 declared
 * their foreign keys in PROSE (`"description": "FK to bikes.id"`) and none in `references`.
 * A derivation that only read `references` would have fired on zero real projects.
 */
export function foreignKeyColumns(tables: LoadedTable[]): Map<string, string> {
  const byName = new Map<string, string>(tables.map((t) => [norm(t.name), t.name]));
  const resolved = new Map<string, string>();
  const conflicted = new Set<string>();

  const claim = (column: string, table: string) => {
    const existing = resolved.get(column);
    if (existing !== undefined && existing !== table) conflicted.add(column);
    else resolved.set(column, table);
  };

  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    const relationVia = new Map<string, string>();
    for (const rel of Object.values(table.schema.relations ?? {})) {
      if ('belongsTo' in rel && byName.has(norm(rel.belongsTo))) relationVia.set(rel.via, rel.belongsTo);
    }

    for (const [column, col] of Object.entries(table.schema.columns)) {
      if (col.primaryKey) continue;
      const declared = col.references?.table;
      if (declared && byName.has(norm(declared))) {
        claim(column, byName.get(norm(declared)) as string);
        continue;
      }
      const viaRelation = relationVia.get(column);
      if (viaRelation) {
        claim(column, byName.get(norm(viaRelation)) as string);
        continue;
      }
      const base = idColumnBase(column);
      const guessed = base ? byName.get(norm(base)) : undefined;
      if (guessed) claim(column, guessed);
    }
  }

  for (const column of conflicted) resolved.delete(column);
  return resolved;
}

/**
 * `customer_id` → the `customers` table, when exactly one table answers to that name.
 *
 * Deliberately NOT a fuzzy match: an ambiguous or unknown base yields nothing, so a property the
 * project cannot explain stays a plain input rather than sprouting a picker onto the wrong list.
 */
function conventionTarget(property: string, tables: LoadedTable[]): string | undefined {
  const base = idColumnBase(property);
  if (!base) return undefined;
  const matches = tables.filter((t) => norm(t.name) === norm(base));
  return matches.length === 1 ? (matches[0] as LoadedTable).name : undefined;
}

// ── which endpoint lists a table ─────────────────────────────────────────────

/** Follow a local `$ref` against a document root. Non-refs and dead pointers pass through. */
function deref(node: JsonSchema | undefined, root: JsonSchema, seen = new Set<string>()): JsonSchema | undefined {
  const ref = node?.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node;
  if (seen.has(ref)) return node;
  seen.add(ref);
  let target: unknown = root;
  for (const rawSeg of ref.slice(2).split('/')) {
    const seg = rawSeg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!target || typeof target !== 'object') return node;
    target = (target as Record<string, unknown>)[seg];
  }
  if (!target || typeof target !== 'object') return node;
  return deref(target as JsonSchema, root, seen);
}

function propertiesOf(node: JsonSchema | undefined): Record<string, JsonSchema> {
  const props = node?.properties;
  return props && typeof props === 'object' ? (props as Record<string, JsonSchema>) : {};
}

/**
 * The item schema of a LIST-shaped Output — either a bare array or the pipeline's
 * `{ items: T[] }` envelope, which is the shape `12-implement_endpoints.md` mandates for
 * every read endpoint.
 */
function listItemSchema(output: JsonSchema): JsonSchema | undefined {
  const root = deref(output, output) ?? output;
  const asArray = root.type === 'array' ? deref(root.items as JsonSchema | undefined, output) : undefined;
  if (asArray) return asArray;
  const items = propertiesOf(root)['items'];
  const resolved = deref(items, output);
  if (!resolved || resolved.type !== 'array') return undefined;
  return deref(resolved.items as JsonSchema | undefined, output);
}

/** The scalar JSON-Schema type of a node, `null` stripped from a nullable union. */
function scalarType(node: JsonSchema | undefined): string | undefined {
  const t = node?.type;
  if (Array.isArray(t)) return t.find((x) => x !== 'null') as string | undefined;
  return typeof t === 'string' ? t : undefined;
}

/** The label property of an options row: the preference list, else the first plain string. */
function labelPropertyOf(item: JsonSchema): string | undefined {
  const props = propertiesOf(item);
  for (const preferred of LABEL_PREFERENCE) {
    if (props[preferred] && scalarType(props[preferred]) === 'string') return preferred;
  }
  // Deterministic fallback: schema property order, skipping the id and any other key.
  for (const [key, node] of Object.entries(props)) {
    if (key === 'id' || idColumnBase(key)) continue;
    if (scalarType(node) === 'string') return key;
  }
  return undefined;
}

/** True when this endpoint can be called with NO arguments at all. */
function callableWithNoInput(ep: EndpointContract): boolean {
  if (ep.routePath.includes(':')) return false;
  const required = (deref(ep.inputSchema, ep.inputSchema) ?? ep.inputSchema).required;
  return !Array.isArray(required) || required.length === 0;
}

/** True when the endpoint's route or name mentions the table (singular or plural). */
function mentionsTable(ep: EndpointContract, table: string): boolean {
  const target = norm(table);
  const words = `${ep.routePath} ${ep.name}`.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.some((w) => norm(w) === target);
}

/** One endpoint that could supply options for a table, with the label path it would use. */
interface OptionSource {
  ep: EndpointContract;
  labelProperty: string;
}

/**
 * Every GET endpoint that could supply this table's options, best first.
 *
 * The order is a total one, so the pick is reproducible: purpose-built pickers
 * (`customers/select`) before general lists, then the NARROWEST row (a two-field
 * `{ id, label }` is a picker's payload; a nine-field row is a page's), then the shortest
 * route, then the name. Nothing here consults the filesystem or a hash.
 */
export function optionSourcesFor(table: string, endpoints: EndpointContract[]): OptionSource[] {
  const candidates: Array<{ source: OptionSource; rank: [number, number, number, string] }> = [];
  for (const ep of endpoints) {
    if (ep.method !== 'GET') continue;
    if (!mentionsTable(ep, table)) continue;
    if (!callableWithNoInput(ep)) continue;
    const item = listItemSchema(ep.outputSchema);
    if (!item) continue;
    const props = propertiesOf(item);
    if (!props['id']) continue; // no stable value to submit
    const labelProperty = labelPropertyOf(item);
    if (!labelProperty) continue; // nothing to show the user
    const selectish = SELECTISH.some((w) => `${ep.routePath} ${ep.name}`.toLowerCase().includes(w)) ? 0 : 1;
    candidates.push({
      source: { ep, labelProperty },
      rank: [selectish, Object.keys(props).length, ep.routePath.length, ep.name],
    });
  }
  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      const d = (a.rank[i] as number) - (b.rank[i] as number);
      if (d !== 0) return d;
    }
    return String(a.rank[3]).localeCompare(String(b.rank[3]));
  });
  return candidates.map((c) => c.source);
}

// ── the pass ─────────────────────────────────────────────────────────────────

/**
 * Fill in `x-options` on every foreign-key Input property of every form endpoint that
 * does not already carry one. **Mutates `endpoints[].inputSchema` in place**, because that
 * schema is the single object the ajv validator, the browser endpoint manifest
 * (`./pages.ts#endpointManifest`), the native `GET /api/apps/:id/views` payload and the
 * renderer's `deriveFields` all read — annotating a copy would fix the form on exactly
 * none of them.
 *
 * `x-options` is an ANNOTATION: it constrains nothing, ajv is told to ignore the keyword
 * (`./validate.ts`), and the property's declared type is untouched. So the worst case of a
 * wrong derivation is a picker over the wrong list, never a request that stops validating.
 */
export function deriveFormOptions(tables: LoadedTable[], endpoints: EndpointContract[]): DerivedFormOptions {
  const result: DerivedFormOptions = { applied: [], unresolved: [] };
  const fks = foreignKeyColumns(tables);
  if (fks.size === 0) return result;

  for (const ep of endpoints) {
    if (!FORM_METHODS.has(ep.method)) continue;
    const root = deref(ep.inputSchema, ep.inputSchema) ?? ep.inputSchema;
    const props = propertiesOf(root);
    // A `[param]` in the route is the row's own identity, supplied by the page — never a
    // field the user picks, so it must not sprout a control.
    const routeParams = new Set((ep.routePath.match(/:([A-Za-z0-9_]+)/g) ?? []).map((s) => s.slice(1)));

    for (const [property, schema] of Object.entries(props)) {
      if (routeParams.has(property)) continue;
      if (schema[X_OPTIONS_KEYWORD]) continue; // a hand-written annotation always wins
      if (typeof schema.$ref === 'string') continue; // a named type: not a scalar FK
      const type = scalarType(schema);
      if (type !== 'string' && type !== 'number' && type !== 'integer') continue;
      // The map is built by walking table COLUMNS, so it only knows names some table declares.
      // A write endpoint's Input is not limited to that: scenario 30's `jobs-create` takes a
      // `customer_id` that no table has (it narrows the bike picker), and that is precisely the
      // field the shop owner had to type a UUID into. So fall back to the naming convention,
      // accepted only when exactly one table matches — the same bar `foreignKeyColumns` uses.
      const table = fks.get(property) ?? conventionTarget(property, tables);
      if (!table) continue;

      const sources = optionSourcesFor(table, endpoints).filter((s) => s.ep.name !== ep.name);
      const best = sources[0];
      if (!best) {
        result.unresolved.push({
          endpoint: ep.name,
          property,
          table,
          candidates: endpoints.filter((e) => e.method === 'GET' && mentionsTable(e, table)).map((e) => e.name),
        });
        continue;
      }

      const annotation: XOptions = {
        query: best.ep.name,
        label: `$.${best.labelProperty}`,
        value: '$.id',
      };
      schema[X_OPTIONS_KEYWORD] = annotation;
      result.applied.push({ endpoint: ep.name, property, table, query: best.ep.name });
    }
  }

  return result;
}
