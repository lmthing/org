/**
 * Write-time lint for generated app artifacts.
 *
 * The typed writers (`writeProjectApi/Page/Hook/Component/Table` and the catalog twins) validate
 * parse + slug + column names today, but NOT the real loader/compiler CONTRACT — so a file the app
 * loader will later reject (an API endpoint with no `export const name`, a page with no default
 * export, a hook of the wrong shape, a schema with a dangling relation) is accepted at write time and
 * only fails downstream at compile/serve, with a confusing error far from the cause.
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
import { apiEndpointContractError, parseExportedString } from '../api/loader.js';
import { evalHookDefaultFromSource } from '../hooks/loader.js';
import { INVISIBLE_AS_TEXT, textTokenFor } from './tokens.js';

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

/**
 * Globals that are undeclared AND have a sanctioned replacement, with the replacement for each.
 *
 * The ambient is deliberately NO-DOM (`lib: ['lib.es2020.d.ts']`, `build/typecheck.ts:L33`), so a
 * much LONGER list of names is a `Cannot find name` error. This map is deliberately NOT that list.
 * Rejecting a write is only defensible where the author has somewhere else to go, and the two are
 * not the same set — measured, not assumed:
 *
 *  - Scanning the 5 shipped store apps flagged 57 of 459 files on the full undeclared list. They are
 *    live and working, because a page runs in a real browser and an endpoint runs in real Node —
 *    `window`, `setTimeout` and `fetch` all EXIST at runtime; they were merely untyped. A lint that
 *    rejects those blocks working code, which is worse than the fault it prevents.
 *  - `fetch`, `crypto`, `console`, `setTimeout`/`setInterval` were therefore fixed the other way:
 *    they are now DECLARED in the ambient (`build/typecheck.ts`), so they neither error nor reject.
 *    Nothing is gained by forbidding a call that works and has no sanctioned alternative.
 *
 * What is left is the DOM proper, and only for pages/components: reaching for `document` instead of
 * JSX and React state is a real practice error with a real answer. Endpoints are not linted this way
 * at all — server code legitimately reaches for whatever Node offers.
 *
 * What remains is caught here rather than at a downstream gate because a write-time throw is fixed
 * by the authoring model IN THE SAME TURN, holding the file's full context. Run 34 of 06-tanzania is
 * the case for it: `verify` reported these correctly three nodes later, and the `fix` node then
 * failed to repair them across every attempt its `onFail` budget allowed.
 */
const ABSENT_UI_GLOBALS: Record<string, string> = {
  XMLHttpRequest: 'read through the `useApi`/`useApiMutation` hooks from `@app/runtime`',
  WebSocket: 'read through an endpoint and the `@app/runtime` hooks',
  document: 'express it as JSX and React state — the app renders through `@app/runtime`, which declares no DOM',
  window: 'express it as JSX and React state — the app renders through `@app/runtime`, which declares no DOM',
  navigator: 'express it as JSX and React state — the app renders through `@app/runtime`, which declares no DOM',
  alert: 'render the message as JSX instead of interrupting with a dialog',
  localStorage: 'persist through a table and an endpoint — that is what survives a reload for a real user',
  sessionStorage: 'persist through a table and an endpoint, or hold it in React state',
};


/** Source with comments, strings and template literals blanked, so a scan sees CODE only. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/** True when `name` is bound in this module, so the bare identifier is NOT the missing global. */
function isLocallyBound(code: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`\\b(?:const|let|var|function|class)\\s+${n}\\b`).test(code) ||
    new RegExp(`\\bimport\\b[^;\\n]*\\b${n}\\b[^;\\n]*from\\b`).test(code)
  );
}

/**
 * The first use of a global the ambient does not declare. Property accesses (`ctx.crypto`, `a.fetch`)
 * and locally-bound names are skipped, so only a real bare reference is reported.
 */
export function absentGlobalUse(src: string, kind: 'page' | 'component'): string | null {
  const map = ABSENT_UI_GLOBALS;
  const code = codeOnly(src);
  for (const name of Object.keys(map)) {
    // `(?<![.\w$])` rejects `ctx.fetch` and `prefetch`; `(?![\w$])` rejects `fetchAll`.
    if (!new RegExp(`(?<![.\\w$])${name}(?![\\w$])`).test(code)) continue;
    if (isLocallyBound(code, name)) continue;
    return (
      `${kind} rejected (not saved): \`${name}\` is not declared for a project app — the ambient is ` +
      `deliberately NO-DOM (\`lib: ['lib.es2020.d.ts']\`), so this is a \`Cannot find name '${name}'\` ` +
      `typecheck error and the build stops before the bundle. Instead: ${map[name]}.`
    );
  }
  return null;
}

/** True when the source has a default export in any form the bundler/loader accepts. */
function hasDefaultExport(src: string): boolean {
  return /export\s+default\b/.test(src) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(src);
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

/**
 * Every UI check a page and a component share, in the order a fix should be attempted. `projectRoot`
 * enables the cross-artifact endpoint checks; omit it and they are skipped (the shape checks still run).
 */
function lintUiSource(src: string, kind: 'page' | 'component', projectRoot?: string): string | null {
  const absent = absentGlobalUse(src, kind);
  if (absent) return absent;
  const descriptor = displayDescriptorReturn(src, kind);
  if (descriptor) return descriptor;
  const token = invisibleTextToken(src, kind);
  if (token) return token;
  if (projectRoot) return apiCallSiteError(src, kind, discoverApiEndpoints(projectRoot));
  return null;
}

/** A page must default-export a component (else the page bundle has nothing to render). */
export function lintPageSource(src: string, opts: { projectRoot?: string } = {}): string | null {
  if (!hasDefaultExport(src)) {
    return (
      'page rejected (not saved): no default export — a page must `export default` a React component. ' +
      'Add `export default function Page() { … }` and re-write.'
    );
  }
  return lintUiSource(src, 'page', opts.projectRoot);
}

/** A shared component must default-export the component an importing page renders. */
export function lintComponentSource(src: string, opts: { projectRoot?: string } = {}): string | null {
  if (!hasDefaultExport(src)) {
    return (
      'component rejected (not saved): no default export — a component must `export default` its ' +
      'React component. Add `export default function <Name>() { … }` and re-write.'
    );
  }
  return lintUiSource(src, 'component', opts.projectRoot);
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

// ── Source-shape helpers (shared by the write-time cross-artifact checks) ──────

/**
 * The text inside the `{…}` whose opening brace is at `open` (null if unbalanced). Shared by the
 * column check in `globals.ts` and the call-site/descriptor checks here — one brace matcher, so the
 * writers can never disagree about where an object literal ends.
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
 * Handles BOTH `key: value` and **shorthand** `{ id }`. Shorthand is not a nicety: `useApi('x', { id })`
 * is the idiomatic call form, and reading it as an empty key set would make the param-arity check
 * reject the most common CORRECT code there is. It matters for the column check too — `db.insert('t',
 * { title, body })` writes those columns just as much as the long form does.
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

/** One `useApi('x', …)` / `useApiMutation('x', …)` / `apiCall('x', …)` call site in UI source. */
export interface ApiCallSite {
  /** Which data global was called — decides whether the 2nd argument is the endpoint INPUT. */
  fn: 'useApi' | 'useApiMutation' | 'apiCall';
  /** The literal endpoint name (the first argument). */
  name: string;
  /** True when a 2nd argument was passed at all. */
  hasInput: boolean;
  /** Top-level keys of the 2nd argument when it is an object LITERAL; null otherwise (a spread, a
   *  variable, a call — the keys are not statically knowable, so the arity check stays silent). */
  inputKeys: string[] | null;
}

/**
 * Every literal API call site in a page/component source.
 *
 * The single extractor behind both the data-wipe guard (`globals.ts#fetchedRoutes`, which needs only
 * the names) and the endpoint-existence / param-arity checks below (which need the input too).
 */
export function apiCallSites(src: string): ApiCallSite[] {
  const out: ApiCallSite[] = [];
  for (const m of src.matchAll(/\b(useApi|useApiMutation|apiCall)\b/g)) {
    const fn = m[1] as ApiCallSite['fn'];
    // Skip the generic (`useApi<{ items: Row[] }>(…)`) and take the first literal argument.
    const after = m.index! + m[0].length;
    const tail = src.slice(after, after + 400);
    const open = tail.indexOf('(');
    if (open < 0) continue;
    const args = tail.slice(open);
    const lit = /^\(\s*['"`]([^'"`]+)['"`]/.exec(args);
    if (!lit) continue;
    // Everything after the name literal: `, { … }` / `, input` / `)`.
    const rest = args.slice(lit[0].length).replace(/^\s*/, '');
    let hasInput = false;
    let inputKeys: string[] | null = null;
    if (rest.startsWith(',')) {
      const second = rest.slice(1).replace(/^\s*/, '');
      if (!second.startsWith(')')) {
        hasInput = true;
        if (second.startsWith('{')) {
          const body = braceBody(second, 0);
          // A spread hides the real keys — treat the input as unknowable, not as empty.
          if (body !== null && !body.includes('...')) inputKeys = topLevelKeys(body);
        }
      }
    }
    out.push({ fn, name: lit[1]!, hasInput, inputKeys });
  }
  return out;
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

/**
 * Reject a page/component that calls an endpoint the project does not have, or that calls a
 * PARAMETERIZED endpoint without supplying its route params.
 *
 * Both defects build clean and fail only in the browser:
 *   - `useApi('costs-summary')` where no handler exports that name — the fetch 404s and the section
 *     renders permanently empty. The ambient declares `useApi<T>(name: string)`, so ANY string
 *     typechecks; run 32's costs page was dead for exactly this reason.
 *   - `useApi('trips-detail')` on route `api/trips/[id]` — the client fills `:id` with
 *     `String(input['id'])` (`runtime/client.ts#fillPath`), so the URL becomes `/api/trips/undefined`.
 *     That still matches on segment count (`loader.ts#matchRoute`) and still passes ajv, so the
 *     endpoint returns a plausible **200 with the wrong row**. Nothing anywhere reports an error.
 *
 * Conservative, like `unknownColumnsIn`: silent when the project has no endpoints yet (a UI shell may
 * legitimately be authored first), when the call's input is not an object literal, and for
 * `useApiMutation` — whose 2nd argument is OPTIONS (`{ invalidates }`), not input; its params arrive
 * later at `mutate(input)` and are not statically knowable here.
 */
export function apiCallSiteError(
  src: string,
  kind: 'page' | 'component',
  endpoints: Map<string, EndpointFacts>,
): string | null {
  if (endpoints.size === 0) return null;
  const known = [...endpoints.keys()].sort();
  for (const site of apiCallSites(src)) {
    const ep = endpoints.get(site.name);
    if (!ep) {
      const near = known.find((k) => k.includes(site.name) || site.name.includes(k));
      return (
        `${kind} rejected (not saved): ${site.fn}('${site.name}') — this project has no endpoint named ` +
        `"${site.name}"${near ? ` (did you mean "${near}"?)` : ''}. The endpoint is addressed by its ` +
        '`export const name`, not by its route. The names that exist are: ' +
        `${known.join(', ')}. Use one of those, or author the endpoint first with writeProjectApi — ` +
        'a call to a name nothing exports renders an empty section forever.'
      );
    }
    // `useApiMutation`'s 2nd arg is options, not input — its params come from `mutate(...)`.
    if (site.fn === 'useApiMutation' || ep.paramNames.length === 0) continue;
    const need = ep.paramNames;
    if (!site.hasInput) {
      return (
        `${kind} rejected (not saved): ${site.fn}('${site.name}') passes no input, but that endpoint's ` +
        `route (${ep.dir}) is parameterized and needs ${need.map((p) => `"${p}"`).join(', ')}. ` +
        `Call it as ${site.fn}('${site.name}', { ${need.map((p) => `${p}: <value>`).join(', ')} }). ` +
        'Without the param the URL is built with the literal string "undefined", which still matches ' +
        'the route and still returns 200 — you get the WRONG row, silently, with no error to debug.'
      );
    }
    if (site.inputKeys === null) continue; // not an object literal — keys unknowable
    const missing = need.filter((p) => !site.inputKeys!.includes(p));
    if (missing.length) {
      return (
        `${kind} rejected (not saved): ${site.fn}('${site.name}') is missing the route ` +
        `${missing.length === 1 ? 'param' : 'params'} ${missing.map((p) => `"${p}"`).join(', ')} — ` +
        `its route (${ep.dir}) needs ${need.map((p) => `"${p}"`).join(', ')} but the input object ` +
        `supplies ${site.inputKeys!.length ? site.inputKeys!.map((k) => `"${k}"`).join(', ') : 'nothing'}. ` +
        `Add ${missing.map((p) => `${p}: <value>`).join(', ')} to the input object. A missing param is ` +
        'stringified to "undefined" in the URL, which still returns 200 with the wrong row.'
      );
    }
  }
  return null;
}

/**
 * Reject a page/component that RETURNS this system's own `display()` descriptor instead of JSX.
 *
 * `{ type, props }` is the chat/tasklist display protocol — a serialized descriptor the surface
 * interprets — not a renderable React element. React sees a plain object child, cannot render it, and
 * throws **error #31** ("Objects are not valid as a React child") at runtime. It typechecks and
 * bundles perfectly, so every build gate passes and the page white-screens on open.
 *
 * Tight on purpose: only an object literal returned from a function whose keys are exactly a subset
 * of the descriptor's own (`type`/`props`/`children`/`key`) AND which carries both `type` and `props`.
 * Any other returned object (a hook result, a memo, a config) is untouched.
 */
export function displayDescriptorReturn(src: string, kind: 'page' | 'component'): string | null {
  const DESCRIPTOR_KEYS = new Set(['type', 'props', 'children', 'key']);
  for (const m of src.matchAll(/\breturn\s*\(?\s*\{/g)) {
    const open = src.indexOf('{', m.index!);
    const body = braceBody(src, open);
    if (body === null) continue;
    const keys = topLevelKeys(body);
    if (keys.length < 2 || !keys.includes('type') || !keys.includes('props')) continue;
    if (!keys.every((k) => DESCRIPTOR_KEYS.has(k))) continue;
    return (
      `${kind} rejected (not saved): this returns a \`{ ${keys.join(', ')} }\` object literal, which is ` +
      "lmthing's display() DESCRIPTOR shape (the chat/tasklist protocol) — NOT a React element. It " +
      'typechecks and bundles, then throws React error #31 ("Objects are not valid as a React child") ' +
      `the moment the ${kind} is opened, so the user sees a blank screen. Return JSX instead: ` +
      '`return <div className="…">…</div>`. A project-app page/component is plain React — build the ' +
      'markup with JSX tags, never with a descriptor object.'
    );
  }
  return null;
}

/**
 * Reject `text-<surface-token>` — a valid Tailwind utility that renders **invisible text**.
 *
 * See {@link INVISIBLE_AS_TEXT} for how the list is derived from `tokens.json`'s `role` field and
 * why the bar is "unreadable at any size" rather than "below AA".
 */
export function invisibleTextToken(src: string, kind: 'page' | 'component'): string | null {
  // `(?![\w-])` is what keeps `text-muted-foreground` (the CORRECT token) from matching `muted`.
  const re = new RegExp(`\\b(?:[a-z-]+:)*text-(${INVISIBLE_AS_TEXT.join('|')})(?![\\w-])`, 'g');
  const m = re.exec(src);
  if (!m) return null;
  const token = m[1]!;
  const fix = textTokenFor(token);
  return (
    `${kind} rejected (not saved): \`${m[0]}\` sets the TEXT colour to \`--${token}\`, which is a ` +
    'SURFACE (background) token — the text renders at a contrast ratio near 1:1 against the page and ' +
    `is literally invisible. \`text-${token}\` is a real Tailwind utility (theme.css registers every ` +
    'colour token, so `text-`/`bg-`/`border-` exist for all of them), so it compiles clean and no ' +
    `build gate catches it. Use \`text-${fix}\` for text; \`${token}\` belongs on \`bg-${token}\`. ` +
    'The token whose name ends in `-foreground` is always the text half of a surface/text pair.'
  );
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
