/**
 * Write-time lint for generated app artifacts.
 *
 * The typed writers (`writeProjectApi/Hook/Table`) validate parse + slug + column names today, but
 * NOT the real loader/compiler CONTRACT — so a file the app loader will later reject (an API
 * endpoint with no `export const name`, a hook of the wrong shape, a schema with a dangling
 * relation) is accepted at write time and only fails downstream at compile/serve, with a confusing
 * error far from the cause.
 *
 * These validators mirror the ACTUAL loader contracts by reusing the loaders' own functions
 * (`apiEndpointContractError`, `validateHook`, `validateSchemaSet`), so the lint can never drift from
 * what the app requires. Each returns a human message (the first violation) or null. The writer
 * throws a {@link LintError} on a non-null result, which the model sees as a retryable error and
 * fixes in place — like a typecheck failure. (Lives in `libs/cli` because it reuses the CLI loaders;
 * `@lmthing/core` must never import it.)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { apiEndpointContractError, parseExportedString } from '../api/loader.js';
import { evalHookDefaultFromSource } from '../hooks/loader.js';

/**
 * A write-time CONTRACT violation in generated content (not an fs/host failure). Writers re-throw
 * this past their catch-to-`{ok:false}`, so it surfaces to the model as a retryable error rather
 * than a swallowed `{ ok:false }` a node might ignore.
 */
export class LintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LintError';
  }
}

const HTTP_METHOD_FILE_RE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

/** True when the source has a default export in any form the bundler/loader accepts. */
function hasDefaultExport(src: string): boolean {
  return /export\s+default\b/.test(src) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(src);
}

/**
 * An api handler may import ONLY `@app/runtime` (for `HttpError`) or a Node builtin (`node:crypto`,
 * `node:util`, …) — a handler runs in real Node. The db reaches it as the injected `ctx` parameter,
 * the contract types are global ambients, and `fetch`/`crypto` are globals. Anything else — a `@app/*`
 * package, a relative helper, a third-party dep — is a guaranteed `Cannot find module` at typecheck.
 *
 * Caught at WRITE time because the model repeatedly invents a db module (`@app/database`, `@app/db`)
 * — 06-tanzania run 36 spent many turns circling `Cannot find module '@app/database'`. A list-based
 * ban fails (it invents the next fake name); the allowlist is exhaustive, so it catches the whole
 * class. Verified against all 216 handler imports across the 5 shipped store apps: only `@app/runtime`
 * and `node:*` appear, and both pass.
 */
function illegalHandlerImport(src: string): string | null {
  // Strip COMMENTS but keep string literals — the module specifier lives in a string, so `codeOnly`
  // (which blanks strings too) would erase exactly what this check reads. Match only a LINE-START
  // import statement, so `const s = "import x from 'y'"` (the word inside a string) never trips it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const re = /^\s*import\b[^;\n]*?\bfrom\s*['"`]([^'"`]+)['"`]/gm;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const spec = m[1] as string;
    if (spec === '@app/runtime' || spec.startsWith('node:')) continue;
    return (
      `api endpoint rejected (not saved): a handler imports from "${spec}", which does not exist — a ` +
      "handler's ONLY legal import is `import { HttpError } from '@app/runtime'`. The database reaches " +
      'you as the injected `ctx` parameter (`ctx.db.query/insert/update/remove`), never an import; ' +
      'there is no `@app/database` or `@app/db`. Contract types (`<Name>Output`) are global — no ' +
      'import. Delete this import and read through `ctx.db`.'
    );
  }
  return null;
}

/**
 * The API-endpoint contract at write time: the loader's own `export const name` check
 * ({@link apiEndpointContractError}), a default/`handler` export (the runtime handler-module
 * contract, `api/handler-module.ts#loadHandlerFromCode`), and a project-unique name.
 */
export function lintApiHandler(src: string, opts: { existingNames?: Map<string, string> } = {}): string | null {
  const contractErr = apiEndpointContractError(src);
  if (contractErr) {
    return `api endpoint rejected (not saved): ${contractErr}. Add e.g. \`export const name = 'itemsList'\` and re-write.`;
  }
  const badImport = illegalHandlerImport(src);
  if (badImport) return badImport;
  const hasHandler =
    hasDefaultExport(src) ||
    /export\s+(?:async\s+)?function\s+handler\b/.test(src) ||
    /export\s+const\s+handler\b/.test(src);
  if (!hasHandler) {
    return (
      'api endpoint rejected (not saved): no request handler — an endpoint must `export default` a ' +
      'handler function (or `export function handler`). Add `export default async (req, ctx) => { … }` and re-write.'
    );
  }
  const name = parseExportedString(src, 'name');
  if (name && opts.existingNames) {
    const owner = opts.existingNames.get(name);
    if (owner) {
      return (
        `api endpoint rejected (not saved): the name "${name}" is already used by ${owner} — endpoint ` +
        'names are unique per project. Pick a different `export const name` (or edit that file).'
      );
    }
  }
  return null;
}

/** `cost-lines` / `dashboard-stats` → `CostLines` / `DashboardStats` — the PascalCase base the
 *  contract keys `<Base>Input`/`<Base>Output`/`<Base>Item` on (mirrors `09-emit_types.ts#pascal`). */
function pascalCase(raw: string): string {
  const parts = String(raw ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const joined = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `T${joined}` : joined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read the emitted global-ambient contract (`types/contract.d.ts`), or `null` when absent/unreadable. */
function readContractDts(projectRoot?: string): string | null {
  if (!projectRoot) return null;
  try {
    const p = join(projectRoot, 'types', 'contract.d.ts');
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Locate the endpoint's request handler — the default export (a function or arrow), else a `handler`
 * function/const. Mirrors the runtime's handler resolution
 * (`api/handler-module.ts#loadHandlerFromCode`: default export first, then `handler`), so what this
 * check reads is exactly what will run.
 */
function findHandlerFn(sf: ts.SourceFile): ts.FunctionLikeDeclaration | null {
  const asFn = (n: ts.Node): ts.FunctionLikeDeclaration | null =>
    ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
      ? (n as ts.FunctionLikeDeclaration)
      : null;
  let defaultFn: ts.FunctionLikeDeclaration | null = null;
  let defaultRef: string | null = null;
  const named = new Map<string, ts.FunctionLikeDeclaration>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) named.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) {
          const sig = asFn(d.initializer);
          if (sig) named.set(d.name.text, sig);
        }
      }
    }
    // `export default function …() {}` (named or anonymous).
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    if (ts.isFunctionDeclaration(st) && mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      defaultFn = st;
    }
    // `export default <expr>` — an inline function/arrow, or a reference to a named one.
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const sig = asFn(st.expression);
      if (sig) defaultFn = sig;
      else if (ts.isIdentifier(st.expression)) defaultRef = st.expression.text;
    }
  }
  if (defaultFn) return defaultFn;
  if (defaultRef && named.has(defaultRef)) return named.get(defaultRef)!;
  return named.get('handler') ?? null;
}

/** True when a return annotation is `any` or `Promise<any>` — the vacuous shapes that satisfy every
 *  Output type and let a divergent response compile clean. */
function isAnyReturn(ret: ts.TypeNode): boolean {
  if (ret.kind === ts.SyntaxKind.AnyKeyword) return true;
  if (ts.isTypeReferenceNode(ret) && ts.isIdentifier(ret.typeName) && ret.typeName.text === 'Promise') {
    const arg = ret.typeArguments?.[0];
    if (arg && arg.kind === ts.SyntaxKind.AnyKeyword) return true;
  }
  return false;
}

/** Every `TypeReference` name mentioned inside `node` (e.g. `Promise`, `Output`, `CostLinesOutput`). */
function typeRefNames(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n)) {
      names.push(ts.isIdentifier(n.typeName) ? n.typeName.text : n.typeName.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** True when the return type IS the contract's `<Base>Output`, directly (`Promise<CostLinesOutput>`)
 *  or through a local alias (`export type Output = CostLinesOutput;` + `Promise<Output>`). */
function returnReferencesOutput(ret: ts.TypeNode, src: string, outputType: string): boolean {
  const refs = typeRefNames(ret);
  if (refs.includes(outputType)) return true;
  for (const r of refs) {
    if (r === 'Promise') continue;
    const alias = new RegExp(`\\btype\\s+${escapeRe(r)}\\s*=\\s*([^;\\n]+)`).exec(src);
    if (alias && new RegExp(`\\b${escapeRe(outputType)}\\b`).test(alias[1]!)) return true;
  }
  return false;
}

/**
 * Reject an API handler whose typed boundary is not REAL — the write-time gate the €0.00/"undefined"
 * dashboard defect needed (scenario 07-life-admin, run 26).
 *
 * `emit_types` (node 09) declares `<Base>Input`/`<Base>Output`/`<Base>Item` in the global-ambient
 * `types/contract.d.ts` from the plan's `fields`, BEFORE this endpoint is written, and the same
 * contract's `<Base>Output` is what the page reads via `useApi<<Base>Output>(...)`. So the endpoint and
 * the page agree ONLY if the endpoint's declared response IS that `<Base>Output`. A handler typed
 * `(input: any, ctx: ApiCtx): Promise<any>` satisfies that vacuously — `any` is assignable to and from
 * everything, so the body's return is never checked against ANY Output and the field names it emits can
 * silently diverge from the field names the page reads. It typechecks, esbuild bundles, every gate is
 * green, and the landing page renders `undefined` over a fully-populated db. Only 1 of the run's 19
 * endpoints used `Promise<any>` — but it was the dashboard, so the most-visible endpoint was the broken
 * one.
 *
 * Three rejections, each teaching the fix and each still allowing every handler that WORKS at runtime
 * (a correct response just has to be typed to its real Output — which it compiles against once it is):
 *  1. `input` annotated `any` (or untyped) — a field read off an `any` input is unchecked.
 *  2. the return annotated `any`/`Promise<any>` (or unannotated) — the vacuous escape hatch itself.
 *  3. the return is a concrete-but-WRONG type (an inline/invented Output) when the contract declares a
 *     `<Base>Output` for this endpoint — so the model cannot dodge (2) by inventing a divergent shape.
 * Once the return is pinned to `<Base>Output`, the save-time typecheck (`./save-typecheck.ts`, which
 * loads `contract.d.ts` as a root) does the rest: a body whose fields don't match `<Base>Output` is a
 * hard error on the `return` statement, so the endpoint↔page divergence is caught in the SAME turn.
 *
 * Conservative: silent for a handler shape it cannot resolve (the existence lint owns "no handler"), and
 * when the endpoint has no `<Base>Output` in the contract (mid-life endpoint, no plan) only the `any`
 * ban applies — the explicit-typed escape for a genuinely dynamic endpoint is a concrete type
 * (`Record<string, unknown>`, `{ items: unknown[] }`, …), never `any`.
 */
export function apiHandlerTypingError(src: string, opts: { projectRoot?: string } = {}): string | null {
  const name = parseExportedString(src, 'name');
  if (!name) return null; // `lintApiHandler` owns the missing-name case
  const base = pascalCase(name);
  const outputType = `${base}Output`;
  const inputType = `${base}Input`;
  const contract = readContractDts(opts.projectRoot);
  const hasOutput = contract ? new RegExp(`\\b${escapeRe(outputType)}\\b`).test(contract) : false;

  const sf = ts.createSourceFile('handler.ts', src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const fn = findHandlerFn(sf);
  if (!fn) return null; // an unusual handler shape — the existence lint owns "no handler"

  const REJ = (msg: string): string => `api endpoint rejected (not saved): ${msg}`;
  const ret = fn.type;

  // 1 — a PRESENT input parameter must be a real type, never `any` (explicit) or unannotated
  //     (implicit any). A zero-parameter handler declares it takes nothing and is left alone.
  const inputParam = fn.parameters[0];
  if (inputParam) {
    const inputAnn = inputParam.type;
    if (!inputAnn || inputAnn.kind === ts.SyntaxKind.AnyKeyword) {
      return REJ(
        `the handler's first parameter (\`input\`) is ${!inputAnn ? 'not typed (implicit `any`)' : 'typed `any`'} — ` +
        'a request field read off an `any` input is never checked, so this endpoint and the page can silently ' +
        `disagree on names. Type it \`input: ${hasOutput ? inputType : '<Endpoint>Input'}\` (the global \`emit_types\` ` +
        'declared), never `any`. An endpoint that truly takes no input types it `Record<string, unknown>` — an ' +
        'explicit type, not `any`.',
      );
    }
  }

  // 2 — the return must never be `any` / `Promise<any>`, the vacuous shape that satisfies every Output
  //     type and lets a divergent response compile clean.
  if (ret && isAnyReturn(ret)) {
    return REJ(
      `the handler's return type is \`${ret.getText(sf)}\` — an \`any\`/\`Promise<any>\` return is assignable ` +
      'to anything, so a response shape that does not match what the page reads compiles clean and every field ' +
      'silently comes back `undefined` (the €0.00 / "undefined" dashboard defect). Annotate it ' +
      `\`Promise<${hasOutput ? outputType : '<Endpoint>Output'}>\` — the contract's real Output type, whose ` +
      "fields ARE the response — never `Promise<any>` or `any`.",
    );
  }

  // 3 — when the contract declares this endpoint's `<Base>Output`, the return MUST be it (present, and
  //     referencing it) — so an inline/invented Output can't dodge the divergence check and the page
  //     (which reads `useApi<<Base>Output>`) and this endpoint share ONE shape. Once pinned, the
  //     save-time typecheck (`./save-typecheck.ts`) catches a body whose fields don't match.
  if (hasOutput && (!ret || !returnReferencesOutput(ret, src, outputType))) {
    return REJ(
      `the handler returns \`${ret ? ret.getText(sf) : '(no return annotation)'}\`, but the contract declares ` +
      `this endpoint's response as \`${outputType}\` (\`emit_types\` wrote it into types/contract.d.ts from the ` +
      "plan's `fields`, and the page reads it via `useApi<" + outputType + '>(...)`). Return the contract type ' +
      `so the endpoint and the page share ONE shape: \`export type Output = ${outputType};\` then ` +
      `\`): Promise<Output>\` (or \`Promise<${outputType}>\` directly). An inline or invented Output lets this ` +
      'endpoint drift from what the page reads — the exact divergence that ships a page rendering `undefined` ' +
      'over real data.',
    );
  }
  return null;
}

const HOOK_TYPES = new Set(['cron', 'event', 'webhook']);

/**
 * A hook's GROSS shape: `export default` must be a hook OBJECT with a known `type`. Evaluated with
 * the loader's OWN eval (so write-time sees exactly what load-time will), then a light shape check.
 *
 * Deliberately NOT the full `validateHook` (every/daily/on.event/trigger/handler): the hook LOADER
 * is fail-soft — a hook that fails those finer checks is skipped-with-warn at load, not fatal — so
 * making the finer shape a hard write-time throw would invert that design and could stall a build on
 * a detail the app tolerates. This catches the errors that are unambiguously broken (default is a
 * function/value, or an unknown/missing `type`) and leaves the fine shape to the fail-soft loader.
 */
export function lintHookSource(src: string, _slug: string, file: string): string | null {
  let raw: unknown;
  try {
    raw = evalHookDefaultFromSource(src, file);
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    return `hook rejected (not saved): the module failed to evaluate — ${first}. A hook must \`export default\` a plain object.`;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return (
      'hook rejected (not saved): `export default` must be a hook OBJECT ' +
      "(`{ type: 'cron' | 'event' | 'webhook', … }`), not a function or bare value. Re-write it as an object."
    );
  }
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !HOOK_TYPES.has(type)) {
    return (
      `hook rejected (not saved): the hook \`type\` must be one of ${[...HOOK_TYPES].map((t) => `'${t}'`).join(' | ')} ` +
      `(got ${JSON.stringify(type)}). Set e.g. \`type: 'cron'\` and re-write.`
    );
  }
  return null;
}

// ── Source-shape helpers (shared with the write-time column check in `globals.ts`) ──────

/**
 * The text inside the `{…}` whose opening brace is at `open` (null if unbalanced). Shared with the
 * column check in `globals.ts` — one brace matcher, so the writers can never disagree about where
 * an object literal ends.
 */
export function braceBody(src: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

/**
 * Top-level property names of an object-literal body (nested objects/arrays skipped).
 *
 * Handles BOTH `key: value` and **shorthand** `{ id }`. Shorthand is not a nicety: `db.insert('t',
 * { title, body })` writes those columns just as much as the long form does, and reading it as an
 * empty key set would make the column check miss the most common CORRECT code there is.
 */
export function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let atKey = true;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) atKey = true;
    else if (depth === 0 && atKey) {
      // `'key':` / `key:` / bare `key` (shorthand — terminated by a comma or the end of the body).
      const m = /^\s*(?:['"`]([A-Za-z0-9_]+)['"`]|([A-Za-z_$][\w$]*))\s*(?=[:,]|$)/.exec(body.slice(i));
      if (m) {
        keys.push((m[1] ?? m[2])!);
        i += m[0].length - 1;
        atKey = false;
      } else if (!/\s/.test(c)) atKey = false;
    }
  }
  return keys;
}

/** What the write-time checks need to know about one authored endpoint. */
export interface EndpointFacts {
  /** The `export const name` — how a page addresses it. */
  name: string;
  /** Ordered `[id]`-segment param names of its route (e.g. `['id']`). */
  paramNames: string[];
  /** The project-relative route dir (e.g. `api/trips/[id]`). */
  dir: string;
}

const METHOD_FILE_RE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

/**
 * Discover the endpoints under `<projectRoot>/api/` — the SYNCHRONOUS twin of
 * `api/loader.ts#loadApiRoutes` (the writers are synchronous host globals, so they cannot await it),
 * using the loader's own `parseExportedString` and `[id]` → param convention.
 *
 * Fail-soft by design: an unreadable or name-less handler is skipped rather than throwing, because
 * this runs while the project is half-authored and a sibling's problem must never block THIS write.
 */
export function discoverApiEndpoints(projectRoot: string): Map<string, EndpointFacts> {
  const out = new Map<string, EndpointFacts>();
  const apiDir = join(projectRoot, 'api');
  if (!existsSync(apiDir)) return out;
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, [...segments, entry.name]);
        continue;
      }
      if (!entry.isFile() || !METHOD_FILE_RE.test(entry.name)) continue;
      try {
        const name = parseExportedString(readFileSync(abs, 'utf8'), 'name');
        if (!name || out.has(name)) continue;
        const paramNames = segments.flatMap((s) => {
          const dyn = /^\[(.+)\]$/.exec(s);
          return dyn ? [dyn[1]!] : [];
        });
        out.set(name, { name, paramNames, dir: join('api', ...segments) });
      } catch {
        /* unreadable handler — skip */
      }
    }
  };
  try {
    walk(apiDir, []);
  } catch {
    /* no api dir */
  }
  return out;
}

/** Scan `api/**` for the endpoint names already claimed → `Map<name, project-relative file>`. */
export function existingApiNames(projectRoot: string, excludeFile: string): Map<string, string> {
  const out = new Map<string, string>();
  const apiDir = join(projectRoot, 'api');
  if (!existsSync(apiDir)) return out;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !HTTP_METHOD_FILE_RE.test(entry.name) || abs === excludeFile) continue;
      try {
        const nm = parseExportedString(readFileSync(abs, 'utf8'), 'name');
        if (nm) out.set(nm, abs.slice(projectRoot.length + 1));
      } catch {
        /* unreadable sibling — skip */
      }
    }
  };
  try {
    walk(apiDir);
  } catch {
    /* no api dir */
  }
  return out;
}
