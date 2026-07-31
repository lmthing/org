/**
 * Typed-contract **schema generation** (Phase 4, 4A).
 *
 * The single source of truth for a project's app types is TS + JSDoc:
 *   - `database/<table>.json` — table/column/relation schemas → **row interfaces**
 *   - `api/<route>/<METHOD>.ts` — `export interface Input`/`Output` → **JSON Schema**
 *
 * This module turns both into text/JSON that the rest of the build consumes:
 *   - {@link generateRowTypes} — TS `interface` per table (columns + typed relation
 *     fields, JSDoc'd from each `description`).
 *   - {@link generateEndpointContracts} — per endpoint: JSON Schema for `Input`/
 *     `Output` (via `ts-json-schema-generator`) plus a compact TS-type string.
 *   - {@link generateAppTypes} — writes `<projectRoot>/types/generated.d.ts` (a
 *     git-ignored build artifact) and returns it alongside the endpoint contracts
 *     (which 4B's `validate.ts`/`apicall-dts.ts` consume).
 *
 * Runs in the **Node/cli layer** (npm available). `ts-json-schema-generator` is
 * heavy, so the generator is instantiated **once per handler file per build** —
 * generation is called on save/boot, never per request.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { createGenerator, type Config } from 'ts-json-schema-generator';

import {
  isBelongsTo,
  isHasMany,
  type LoadedTable,
  type ColumnType,
  type RelationSchema,
} from '@lmthing/core';
import { X_OPTIONS_KEYWORD } from '../view-spec/schema.js';
import type { Endpoint } from '../api/loader.js';
import type { HttpMethod } from '../api/input.js';

/** A JSON-Schema-shaped object (draft-07). Kept loose — it is passed to `ajv`. */
export type JsonSchema = Record<string, unknown>;

/**
 * The typed contract for one API endpoint — the unit 4B's `validate.ts` (ajv) and
 * `apicall-dts.ts` (agent DTS overload) consume.
 */
export interface EndpointContract {
  /** Stable agent-facing id (`export const name`). */
  name: string;
  /** HTTP method (from the handler filename). */
  method: HttpMethod;
  /** Route pattern (`[id]` → `:id`), e.g. `/items/:id`. */
  routePath: string;
  /** Human-readable description (`export const description`), `''` when absent. */
  description: string;
  /** JSON Schema for the assembled `Input` (empty-object schema when no `Input`). */
  inputSchema: JsonSchema;
  /** JSON Schema for `Output` (empty-object schema when no `Output`). */
  outputSchema: JsonSchema;
  /** Compact TS-type text for `Input`, e.g. `{ id: string }`. */
  inputTsType: string;
  /** Compact TS-type text for `Output`, e.g. `{ ok: boolean }`. */
  outputTsType: string;
  /**
   * Present ONLY when `ts-json-schema-generator` could not derive this handler's `Input`/`Output`
   * — a handler whose `export type Output = FooOutput` names a type nothing declares, which is
   * exactly what an appbuilder follow-up edit produces when it drops a contract declaration the
   * handler still references. The schemas degrade to the empty-object shape and the endpoint keeps
   * its route, so the failure costs THAT endpoint's typed form and input validation, never the
   * whole app. See {@link buildContract}.
   */
  schemaError?: string;
}

/** Result of {@link generateAppTypes}. */
export interface GeneratedAppTypes {
  /** The full text written to `types/generated.d.ts`. */
  generatedDts: string;
  /** The per-endpoint contracts (cached by the integrator; consumed by 4B). */
  endpoints: EndpointContract[];
}

// ── Row types ───────────────────────────────────────────────────────────────

/** TS type for a column kind. `date` is an ISO string; `json` is opaque `unknown`. */
const COLUMN_TS: Record<ColumnType, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
  json: 'unknown',
};

/**
 * Generate a TS `interface` per table from `database/*.json`.
 *
 * Each column maps by kind (`string→string`, `number→number`, `boolean→boolean`,
 * `date→string` (ISO), `json→unknown`); a **required or primary-key** column is
 * non-optional, every other column is optional (`?`). Each field is JSDoc'd from
 * its `description`. Typed **relation fields** are appended: a `hasMany` →
 * `<Target>[]`, a `belongsTo` → `<Target>`, both optional (present only when
 * `include`d). Output is deterministic (tables sorted by name).
 *
 * Table → interface name: the snake/kebab basename is PascalCased and its **last
 * word singularized** (`feed_items` → `FeedItem`, `comments` → `Comment`,
 * `categories` → `Category`). See {@link tableInterfaceName}.
 */
export function generateRowTypes(tables: LoadedTable[]): string {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  return sorted.map((t) => renderRowInterface(t)).join('\n\n');
}

function renderRowInterface(table: LoadedTable): string {
  const iface = tableInterfaceName(table.name);
  const lines: string[] = [];
  lines.push(`/** ${table.schema.description} */`);
  lines.push(`export interface ${iface} {`);

  for (const [colName, col] of Object.entries(table.schema.columns)) {
    const optional = col.primaryKey || col.required ? '' : '?';
    lines.push(`  /** ${col.description} */`);
    lines.push(`  ${colName}${optional}: ${COLUMN_TS[col.type]};`);
  }

  const relations = table.schema.relations ?? {};
  for (const [relName, rel] of Object.entries(relations)) {
    lines.push(`  /** ${rel.description} */`);
    lines.push(`  ${relName}?: ${relationTsType(rel)};`);
  }

  lines.push('}');
  return lines.join('\n');
}

/** TS type for a relation field — `hasMany` → `Target[]`, `belongsTo` → `Target`. */
function relationTsType(rel: RelationSchema): string {
  if (isHasMany(rel)) return `${tableInterfaceName(rel.hasMany)}[]`;
  if (isBelongsTo(rel)) return tableInterfaceName(rel.belongsTo);
  return 'unknown';
}

/**
 * Map a table name (snake/kebab basename) to its row-interface name.
 *
 * Rule (deterministic): split on `_`/`-`, singularize the **last** word with a
 * small English rule set, then PascalCase every word. E.g. `feed_items` →
 * `FeedItem`, `comments` → `Comment`, `categories` → `Category`,
 * `feed-status` → `FeedStatus` (unchanged tail).
 */
export function tableInterfaceName(tableName: string): string {
  const words = tableName.split(/[_-]+/).filter((w) => w.length > 0);
  if (words.length === 0) return 'Row';
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/**
 * Small deterministic English singularizer for the last word of a table name.
 * Rules, in order: `…{cons}ies` → `…y`; `…{s,x,z,ch,sh}es` → strip `es`; a bare
 * trailing `s` is stripped only when preceded by a "normal" consonant — NOT after
 * `s`/`u`/`i`, which keeps already-singular tails like `status`/`address`/`axis`.
 */
function singularize(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + 'y'; // categories → category
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2); // boxes → box
  if (/[^sui]s$/i.test(word)) return word.slice(0, -1); // items → item (but not status/axis/address)
  return word;
}

// ── Endpoint contracts ──────────────────────────────────────────────────────

const INPUT_TYPE = 'Input';
const OUTPUT_TYPE = 'Output';

/** An empty-object JSON Schema (used when a handler declares no `Input`/`Output`). */
function emptyObjectSchema(): JsonSchema {
  return { type: 'object', properties: {}, additionalProperties: false };
}

/**
 * Build a {@link EndpointContract} for every discovered endpoint.
 *
 * For each handler file a single `ts-json-schema-generator` generator is created
 * and asked for the `Input` and `Output` exported interfaces. A handler with no
 * `Input` (e.g. a param-less GET) yields an empty-object input schema; same for a
 * missing `Output`. The schema is resolved to a self-contained root (its `$ref`
 * inlined, any nested `definitions` retained) so it is directly `ajv`-usable, and
 * a compact TS-type string is derived from it for 4B's `apiCall` overload.
 *
 * When the project carries a `types/contract.d.ts` (the appbuilder's global-ambient
 * type contract — see {@link buildGeneratorConfig}), every handler file's generator
 * program includes it as a second root so `export type Output = FlightsOutput` (a
 * bare global name, no import) resolves. Checked once per call, not once per file.
 *
 * Endpoints are returned sorted by `name` for cache-friendly determinism.
 */
export async function generateEndpointContracts(
  projectRoot: string,
  routes: Endpoint[],
): Promise<EndpointContract[]> {
  const contractDtsPath = join(projectRoot, 'types', 'contract.d.ts');
  const hasContractDts = existsSync(contractDtsPath);
  const contracts = await Promise.all(
    routes.map((ep) => buildContract(ep, hasContractDts ? contractDtsPath : undefined)),
  );
  return contracts.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildContract(ep: Endpoint, contractDtsPath: string | undefined): Promise<EndpointContract> {
  const source = await readFile(ep.file, 'utf8');
  const hasInput = hasExportedType(source, INPUT_TYPE);
  const hasOutput = hasExportedType(source, OUTPUT_TYPE);

  let inputRaw: unknown = null;
  let outputRaw: unknown = null;
  let schemaError = '';
  try {
    // One generator per handler file (heavy) — reused for both Input and Output.
    const generator =
      hasInput || hasOutput ? createGenerator(buildGeneratorConfig(ep.file, contractDtsPath)) : null;

    inputRaw = hasInput && generator ? generator.createSchema(INPUT_TYPE) : null;
    outputRaw = hasOutput && generator ? generator.createSchema(OUTPUT_TYPE) : null;
  } catch (err) {
    /**
     * **A handler the generator cannot read degrades to a permissive contract — it does NOT abort
     * the app.**
     *
     * `createSchema` throws (`UnknownNodeError`, "Unhandled error while creating Base Type.") for a
     * type it cannot resolve, and this whole pass runs under one `Promise.all`, so before this
     * catch a SINGLE handler naming an undeclared type took down `generateAppTypes` — and with it
     * `types/generated.d.ts`, the endpoint manifest, `/api/apps/:id/views` and the entire page
     * build, all reporting one message that named no file. Measured live: an appbuilder follow-up
     * edit re-emitted `types/contract.d.ts` from a plan that no longer covered six already-shipped
     * endpoints, and the app went from working to `POST …/app/build → 400` with the root route
     * 404ing. The typecheck gate had the real, per-file diagnostics all along
     * (`Cannot find name 'BikesListInput'`); the build just refused to run alongside them.
     *
     * The degraded endpoint keeps its name, method and route, so every OTHER page still builds and
     * every other endpoint still validates. What it loses is precise: ajv input validation for
     * this one route and the derived form fields for a `create` bound to it. `schemaError` carries
     * the reason so a gate can name the handler instead of the app.
     */
    schemaError = err instanceof Error ? err.message : String(err);
  }

  const inputSchema = inputRaw ? resolveRootSchema(inputRaw as JsonSchema) : emptyObjectSchema();
  const outputSchema = outputRaw ? resolveRootSchema(outputRaw as JsonSchema) : emptyObjectSchema();

  return {
    name: ep.name,
    method: ep.method,
    routePath: ep.pattern,
    description: ep.description ?? '',
    inputSchema,
    outputSchema,
    inputTsType: schemaToTs(inputSchema),
    outputTsType: schemaToTs(outputSchema),
    ...(schemaError ? { schemaError } : {}),
  };
}

/**
 * Escape glob metacharacters in a file path so `ts-json-schema-generator` — which
 * feeds `config.path` through `globSync(normalize(resolve(path)))` — treats a
 * literal path as a literal, not a pattern. **Dynamic api routes** live in
 * bracketed dirs (`api/articles/[id]/GET.ts`); an unescaped `[id]` is a glob
 * character-class that matches nothing, so the generator finds "No input files"
 * and contract/type generation dies for any app with a `[param]` segment.
 *
 * Uses **bracket-wrap** escaping (`[` → `[[]`, `]` → `[]]`, …) rather than
 * backslash escaping because the generator runs the path through `normalize-path`
 * first, which would strip a backslash. Bracket-wrapping survives normalization.
 */
export function escapeGlobPath(file: string): string {
  return file.replace(/[[\]{}()*?]/g, '[$&]');
}

/**
 * Compiler options for the two-root `ts.Program` {@link buildGeneratorConfig} builds when a
 * project has `types/contract.d.ts`. Mirrors `ts-json-schema-generator`'s own no-`tsconfig`
 * default (its `factory/program.js#getTsConfig`) so behavior is unchanged from the plain
 * `generatorConfig(file)` path for everything the generator itself would have produced.
 */
function contractProgramOptions(): ts.CompilerOptions {
  return {
    noEmit: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strictNullChecks: false,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    esModuleInterop: true,
  };
}

/**
 * Build the `ts-json-schema-generator` {@link Config} for one handler file.
 *
 * Plain case (no `types/contract.d.ts`): a single-file `path` glob, as before.
 *
 * Contract case: `ts-json-schema-generator` runs the per-file `Config.path` glob through
 * its OWN `ts.createProgram([file], …)` (`factory/program.js`) — a program of exactly the
 * one handler file. The appbuilder's `emit_types` (`system-appbuilder/tasklists/
 * build_live_project/09-emit_types.ts`) writes `types/contract.d.ts` as a GLOBAL AMBIENT
 * script (no `export`) declaring names like `FlightsOutput`; a handler references it with
 * NO import (`export type Output = FlightsOutput;`), by design (see that file's doc — an
 * import forces relative-depth math an agent abandons on the first wrong `../`). A
 * single-file program never sees that ambient, so the name is unresolved and the generator
 * throws `"Unhandled error while creating Base Type."` for EVERY endpoint that references
 * the contract — which, since `emit_types` is what the appbuilder always runs, is every
 * project it builds. `typecheckProjectApp` (`./typecheck.ts`) already treats
 * `types/contract.d.ts` as a second program root for exactly this reason; passing our OWN
 * pre-built two-root `ts.Program` via `Config.tsProgram` (which `createGenerator` prefers
 * over building one from `path` — `factory/generator.js`: `config.tsProgram ||
 * createProgram(completedConfig)`) gets the same resolution here. `skipTypeCheck` is kept
 * `true` for parity with the plain path, though it has no effect once `tsProgram` is
 * supplied (`Config.skipTypeCheck` is only read by the generator's OWN `createProgram`,
 * which a caller-supplied `tsProgram` bypasses entirely).
 */
function buildGeneratorConfig(file: string, contractDtsPath: string | undefined): Config {
  if (!contractDtsPath) return generatorConfig(file);
  const tsProgram = ts.createProgram([file, contractDtsPath], contractProgramOptions());
  return {
    tsProgram,
    skipTypeCheck: true,
    expose: 'all',
    additionalProperties: false,
    extraTags: EXTRA_TAGS,
  };
}

/**
 * JSDoc annotations `ts-json-schema-generator` must CARRY INTO the generated JSON Schema instead
 * of dropping (its default is to keep only the tags it knows).
 *
 * `x-options` is the only one, and it is what makes a foreign-key form field usable. A `create`
 * section declares no fields — they derive from the mutation's Input schema — so "where do this
 * field's options come from" has nowhere to live except that same contract:
 *
 * ```ts
 * // api/expenses/POST.ts
 * export interface Input {
 *   amount: number;
 *   /** @x-options {"query":"listTravelers","label":"$.name","value":"$.id"} *\/
 *   paidByTravelerId: string;
 * }
 * ```
 *
 * Without the carry-through the annotation is silently discarded here and the renderer's
 * schema-form has no choice but a raw UUID text box — which T0 measured blocking 2 of 10
 * desk-checked pages outright. See `../view-spec/schema.ts#XOptions`.
 */
const EXTRA_TAGS = [X_OPTIONS_KEYWORD];

function generatorConfig(file: string): Config {
  return {
    path: escapeGlobPath(file),
    // Handler ctx types (AsyncDbApi, SpawnFn, …) are ambient/unimported — we only
    // want the Input/Output interfaces, so skip whole-program typechecking.
    skipTypeCheck: true,
    expose: 'all',
    additionalProperties: false,
    extraTags: EXTRA_TAGS,
  };
}

/** True when `source` exports `interface <name>` or `type <name>`. */
function hasExportedType(source: string, name: string): boolean {
  return new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`).test(source);
}

/**
 * Inline a generator result's top-level `$ref` so the returned schema's own
 * `type`/`properties`/`required` describe the root type directly (ajv-usable),
 * while any *other* definitions it referenced are retained under `definitions`.
 */
function resolveRootSchema(generated: JsonSchema): JsonSchema {
  const defs = (generated.definitions as Record<string, JsonSchema> | undefined) ?? {};
  const ref = generated.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/definitions/')) return generated;

  const rootName = decodeURIComponent(ref.slice('#/definitions/'.length));
  const root = defs[rootName];
  if (!root) return generated;

  const rest: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(defs)) if (k !== rootName) rest[k] = v;

  return Object.keys(rest).length > 0 ? { ...root, definitions: rest } : { ...root };
}

// ── Schema → compact TS printer ──────────────────────────────────────────────

/**
 * Print a resolved JSON Schema as a compact single-line TS type string
 * (`{ id: string }`, `{ ok: boolean }`, `string[]`, …). Local `$ref`s resolve
 * against the schema's own `definitions`. Unknown/empty schemas print `unknown`.
 */
function schemaToTs(schema: JsonSchema): string {
  const defs = (schema.definitions as Record<string, JsonSchema> | undefined) ?? {};
  return printNode(schema, defs, new Set());
}

function printNode(node: JsonSchema, defs: Record<string, JsonSchema>, seen: Set<string>): string {
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/definitions/')) {
    const name = decodeURIComponent(ref.slice('#/definitions/'.length));
    if (seen.has(name)) return 'unknown'; // guard against self-referential cycles
    const target = defs[name];
    if (!target) return 'unknown';
    return printNode(target, defs, new Set([...seen, name]));
  }

  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union)) {
    const parts = union.map((s) => printNode(s as JsonSchema, defs, seen));
    return dedupeUnion(parts);
  }

  if (Array.isArray(node.enum)) {
    return dedupeUnion(node.enum.map((v) => JSON.stringify(v)));
  }
  if ('const' in node) return JSON.stringify(node.const);

  const type = node.type;
  if (type === 'array') {
    const items = node.items as JsonSchema | undefined;
    const inner = items ? printNode(items, defs, seen) : 'unknown';
    return needsParens(inner) ? `(${inner})[]` : `${inner}[]`;
  }
  if (type === 'object' || node.properties) return printObject(node, defs, seen);
  if (type === 'string') return 'string';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'null') return 'null';

  return 'unknown';
}

function printObject(node: JsonSchema, defs: Record<string, JsonSchema>, seen: Set<string>): string {
  const props = (node.properties as Record<string, JsonSchema> | undefined) ?? {};
  const required = new Set((node.required as string[] | undefined) ?? []);
  const keys = Object.keys(props).sort(); // deterministic ordering
  if (keys.length === 0) return '{}';
  const fields = keys.map((k) => {
    const opt = required.has(k) ? '' : '?';
    return `${k}${opt}: ${printNode(props[k], defs, seen)}`;
  });
  return `{ ${fields.join('; ')} }`;
}

function dedupeUnion(parts: string[]): string {
  const uniq = [...new Set(parts)];
  return uniq.length === 1 ? uniq[0] : uniq.join(' | ');
}

/** A union needs parenthesising before a `[]` suffix. */
function needsParens(ts: string): boolean {
  return ts.includes(' | ');
}

// ── generated.d.ts ───────────────────────────────────────────────────────────

/**
 * Load a project's tables + api routes, build the row interfaces and endpoint
 * contracts, write `<projectRoot>/types/generated.d.ts` (a **git-ignored build
 * artifact** — created at runtime under a project dir, never committed), and
 * return the dts text plus the endpoint contracts.
 *
 * Deterministic: tables and endpoints are emitted in sorted order so an unchanged
 * project produces byte-identical output (cache-friendly).
 */
export async function generateAppTypes(projectRoot: string): Promise<GeneratedAppTypes> {
  // Cheap filesystem loaders (no db engine, no handler evaluation). Imported
  // relatively-lazily to keep the top of this module purely declarative.
  const { loadProjectApp } = await import('../loader.js');
  const { loadApiRoutes } = await import('../api/loader.js');

  const [app, routes] = await Promise.all([loadProjectApp(projectRoot), loadApiRoutes(projectRoot)]);
  const endpoints = await generateEndpointContracts(projectRoot, routes.endpoints);

  // Fill in the `x-options` a foreign-key form field needs, from the table schemas the
  // handler sources cannot see. Runs HERE rather than in `./contracts.ts` because the
  // browser endpoint manifest is built straight off this function's result
  // (`./pages.ts:endpointManifest`) and never goes through `generateProjectContracts` —
  // annotating there would fix the native form and leave the web one a UUID text box.
  const { deriveFormOptions } = await import('./fk-options.js');
  deriveFormOptions(app.tables, endpoints);

  const generatedDts = renderGeneratedDts(app.tables, endpoints);

  const typesDir = join(projectRoot, 'types');
  await mkdir(typesDir, { recursive: true });
  await writeFile(join(typesDir, 'generated.d.ts'), generatedDts, 'utf8');

  return { generatedDts, endpoints };
}

/** PascalCase an endpoint name for its `Input`/`Output` interface prefix (`markRead` → `MarkRead`). */
function endpointTypePrefix(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
    .replace(/^(.)/, (c) => c.toUpperCase());
}

/** Emit an `Input`/`Output` declaration — `interface` for object shapes, else a `type` alias. */
function renderNamedType(name: string, tsType: string): string {
  return tsType.startsWith('{')
    ? `export interface ${name} ${tsType}`
    : `export type ${name} = ${tsType};`;
}

function renderGeneratedDts(tables: LoadedTable[], endpoints: EndpointContract[]): string {
  const header = [
    '// AUTO-GENERATED — do not edit. Regenerated by the per-project build (@lmthing/cli).',
    '// Source: database/*.json (row types) + api/**/{GET,POST,PUT,PATCH,DELETE}.ts (endpoint I/O).',
  ].join('\n');

  const rows = generateRowTypes(tables);

  const endpointBlocks = endpoints.map((ep) => {
    const prefix = endpointTypePrefix(ep.name);
    const lines: string[] = [];
    if (ep.description) lines.push(`/** ${ep.description} */`);
    lines.push(renderNamedType(`${prefix}Input`, ep.inputTsType));
    lines.push(renderNamedType(`${prefix}Output`, ep.outputTsType));
    return lines.join('\n');
  });

  return [header, rows, ...endpointBlocks].filter((s) => s.length > 0).join('\n\n') + '\n';
}
