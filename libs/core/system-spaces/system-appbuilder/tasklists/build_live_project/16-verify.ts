/**
 * The build gate — HOST-RUN, so it always executes.
 *
 * This replaces `compile_pass1` + `compile_pass2`, which asked the model to re-emit ~50 lines
 * of scanning TypeScript as "one statement" on every pass. In run 32 of the 06-tanzania
 * scenario that accounted for 44 of 124 errors (35%) across the three build steps — cascades of
 * `'gateErrors' is not defined` after one slip. A gate that fails to execute contributes no
 * findings, and the pipeline reads its empty result as "clean", so the failure mode was silent
 * AND load-bearing. As a code node the scan cannot fail to be reproduced.
 *
 * It reports; it never fixes, and it never throws on a finding (a code node has no salvage path
 * — a throw fails the whole node). `fix` fans out over `offending`, then resumes this node via
 * its `onFail`, so the compile→fix cycle loops until clean instead of being hand-unrolled.
 *
 * `buildProjectApp()` covers what the compiler can see: typecheck then esbuild. The scans below
 * cover what it structurally cannot.
 */

export const node = {
  id: 'verify',
  dependsOn: ['implement_tables', 'implement_endpoints', 'smoke_endpoints', 'implement_components', 'implement_pages', 'implement_automations'],
  output: {
    ok: 'boolean',
    built: 'boolean',
    routes: 'array',
    offending: 'array',
    offendingCount: 'number',
  },
};

type Await<T> = T | Promise<T>;

/**
 * EVERY member here must be `await`ed, including the ones that look synchronous.
 *
 * `worker-load-entry.ts` proxies each authoring global into the worker as an RPC stub returning a
 * PROMISE, so `ctx.listProjectDir(dir).entries` reads a property off a Promise — `undefined` — and
 * `walkFiles` silently returns `[]`. The node still resolves, still reports `buildProjectApp`'s
 * compiler errors, and contributes ZERO scan findings, which the pipeline reads as "the scans were
 * clean". That is exactly the silent-and-load-bearing failure this gate exists to end, and it is
 * invisible to a unit test that injects a synchronous mock — which is why one test below drives an
 * all-async ctx.
 */
interface Ctx {
  buildProjectApp: () => Promise<{
    ok: boolean;
    built: boolean;
    routes: string[];
    errors: Array<{ phase: string; file: string; line?: number; column?: number; message: string }>;
  }>;
  listProjectDir: (dir: string) => Await<{ ok: boolean; entries: string[]; error?: string }>;
  readProjectFile: (path: string) => Await<{ ok: boolean; content: string; error?: string }>;
}

interface Finding {
  line?: number;
  phase: string;
  message: string;
}

/** Every `.ts`/`.tsx` file under `dir`, walked breadth-first. */
async function walkFiles(ctx: Ctx, dir: string): Promise<string[]> {
  const out: string[] = [];
  const listed = await ctx.listProjectDir(dir);
  const queue = (listed?.entries || []).map((n) => `${dir}/${n}`);
  while (queue.length > 0) {
    const p = queue.shift() as string;
    if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
      continue;
    }
    const sub = await ctx.listProjectDir(p);
    for (const child of sub?.entries || []) queue.push(`${p}/${child}`);
  }
  return out;
}

async function read(ctx: Ctx, path: string): Promise<string> {
  const r = await ctx.readProjectFile(path);
  return r?.content || '';
}

/** Endpoint names the project's `api/` actually exports, with the route params each needs. */
async function realEndpoints(ctx: Ctx): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const path of await walkFiles(ctx, 'api')) {
    const src = await read(ctx, path);
    const m = /export\s+const\s+name\s*=\s*['"`]([A-Za-z0-9_-]+)['"`]/.exec(src);
    if (!m) continue;
    // Params come from the ROUTE (the directory path), e.g. api/trips/[id]/GET.ts → ['id'].
    const params: string[] = [];
    for (const seg of path.split('/')) {
      const p = /^\[([A-Za-z0-9_]+)\]$/.exec(seg);
      if (p) params.push(p[1] as string);
    }
    found.set(m[1] as string, params);
  }
  return found;
}

/** Table names on disk (`database/<name>.json`). */
async function realTables(ctx: Ctx): Promise<string[]> {
  const listed = await ctx.listProjectDir('database');
  return (listed?.entries || [])
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.replace(/\.json$/, ''));
}

/**
 * Design tokens that name a SURFACE colour. Using one as a text colour (`text-muted`) compiles
 * clean — Tailwind generates `text-*` for every registered colour token — and renders text in
 * its own background colour. A real build shipped 149 of these at contrast 1.08 (WCAG AA needs
 * 4.5): invisible text, and nothing in the toolchain could see it.
 */
const SURFACE_TOKENS: Record<string, string> = {
  muted: 'muted-foreground',
  card: 'card-foreground',
  popover: 'popover-foreground',
  accent: 'accent-foreground',
  secondary: 'secondary-foreground',
  sidebar: 'sidebar-foreground',
  // No `-foreground` partner exists for these — body text is the correct replacement.
  background: 'foreground',
  border: 'foreground',
  input: 'foreground',
};

export async function run(ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const build = await ctx.buildProjectApp();
  const byFile: Record<string, Finding[]> = {};
  const add = (file: string, f: Finding): void => {
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };

  // FOLD IN the runtime probes. `smoke_endpoints` is the only node that actually CALLS a generated
  // endpoint, and its findings must land in `offending` because `fix` fans out over
  // `verify.offending` and nothing else — depending on the node without reading it would compute
  // every 500, every `"undefined"` param and every broken envelope and then throw them away, which
  // is worse than not probing at all: the pipeline would report a gate that ran and found nothing.
  const smoke = inputs['smoke_endpoints'] as
    | { offending?: Array<{ path?: string; errors?: Finding[] }>; unavailable?: boolean; reason?: string }
    | undefined;
  if (smoke?.unavailable) {
    // The probe could not run at all (no `callProjectApi` on ctx). Surface it as a finding rather
    // than letting an un-run gate read as a clean one.
    add('api', { phase: 'smoke', message: `endpoint smoke probes did not run: ${smoke.reason ?? 'unavailable'}` });
  }
  for (const entry of smoke?.offending ?? []) {
    for (const e of entry.errors ?? []) add(String(entry.path ?? 'api'), e);
  }

  for (const e of build.errors) {
    add(e.file, { line: e.line, phase: e.phase, message: e.message });
  }

  const endpoints = await realEndpoints(ctx);
  const endpointNames = [...endpoints.keys()];
  const tables = await realTables(ctx);
  const known = endpointNames.length > 0 ? endpointNames.join(', ') : 'none';

  // (1) An api module querying a table that does not exist. The db surface is dynamically
  // typed, so this builds CLEAN and 500s on every call — as broken as an unresolved import.
  for (const path of await walkFiles(ctx, 'api')) {
    const src = await read(ctx, path);
    const ref = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
    for (let m = ref.exec(src); m; m = ref.exec(src)) {
      if (tables.includes(m[1] as string)) continue;
      add(path, {
        phase: 'gate',
        message:
          `references table "${m[1]}" which does not exist in database/ (have: ${tables.join(', ') || 'none'}) ` +
          `— builds clean but 500s at runtime, exactly like an unresolved import`,
      });
    }
  }

  // (1b) A HOOK (project automation) whose handler reads/writes a table that does not exist, or that
  // subscribes to a synthetic `project/db.<table>.<event>` for a table that never landed. Both build +
  // load clean — the db surface is dynamically typed and a bad hook is skipped-with-warn at load — and
  // then the scheduled/reactive code 500s or never fires, so nothing the user's story promised happens.
  // Most apps author ZERO hooks, so this loop usually walks nothing. Awaited async ctx, like every scan.
  for (const path of await walkFiles(ctx, 'hooks')) {
    const src = await read(ctx, path);
    const ref = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
    for (let m = ref.exec(src); m; m = ref.exec(src)) {
      if (tables.includes(m[1] as string)) continue;
      add(path, {
        phase: 'gate',
        message:
          `hook references table "${m[1]}" which does not exist in database/ (have: ${tables.join(', ') || 'none'}) ` +
          `— the automation loads clean but its handler 500s on every run. Point it at a real table (or create it).`,
      });
    }
    const evt = /['"`]project\/db\.([A-Za-z0-9_]+)\.(?:insert|update|remove)['"`]/g;
    for (let m = evt.exec(src); m; m = evt.exec(src)) {
      if (tables.includes(m[1] as string)) continue;
      add(path, {
        phase: 'gate',
        message:
          `hook subscribes to project/db.${m[1]}.* but table "${m[1]}" does not exist in database/ ` +
          `(have: ${tables.join(', ') || 'none'}) — that write is never emitted, so the automation never fires.`,
      });
    }
  }

  // (2)+(3)+(4) Client-side scans over pages/ and components/.
  for (const path of [...(await walkFiles(ctx, 'pages')), ...(await walkFiles(ctx, 'components'))]) {
    const src = await read(ctx, path);

    const apiRef =
      /\b(useApiMutation|useApi|apiCall)\s*(?:<[^(]*>)?\s*\(\s*['"`]([A-Za-z0-9_/?=&.-]+)['"`]\s*(,?)/g;
    for (let m = apiRef.exec(src); m; m = apiRef.exec(src)) {
      const caller = m[1] as string;
      const name = m[2] as string;
      if (!endpoints.has(name)) {
        add(path, {
          phase: 'gate',
          message:
            `calls useApi/useApiMutation/apiCall("${name}") which is not a generated endpoint name ` +
            `(have: ${known}) — the client rejects an unknown name BEFORE issuing any request, so the ` +
            `page renders an error state with nothing in the network panel. Use the endpoint's exact ` +
            `\`export const name\`, never the route, the method, or a query string.`,
        });
        continue;
      }
      // `useApiMutation` returns a MUTATE FUNCTION — its input is supplied when that function is
      // called, never at hook time, so a bare `useApiMutation('notes-delete')` is correct even for a
      // `[id]` route. Run 34 flagged exactly that and it was a false positive; a gate that invents
      // work teaches the fixer to "repair" working code, which is worse than missing a fault.
      const params = caller === 'useApiMutation' ? [] : (endpoints.get(name) as string[]);
      if (params.length > 0 && m[3] !== ',') {
        add(path, {
          phase: 'gate',
          message:
            `calls "${name}" with no input, but that route takes ${params.map((p) => `[${p}]`).join('')} ` +
            `— the missing value is stringified into the path ("/api/.../undefined"), which still matches ` +
            `and passes validation, so it returns a plausible 200 carrying the wrong row. Pass ` +
            `{ ${params.map((p) => `${p}: … `).join(', ')}}.`,
        });
      }
    }

    if (/\breturn\s*\{\s*type\s*:\s*(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*,\s*props\s*:/.test(src)) {
      add(path, {
        phase: 'gate',
        message:
          `returns a plain { type, props } object literal instead of JSX — that is this system's OWN ` +
          `display()-descriptor shape (the chat/tasklist protocol), not renderable React. It typechecks ` +
          `clean and throws React error #31 at runtime. Return real JSX (\`<div>…</div>\`).`,
      });
    }

    for (const token of Object.keys(SURFACE_TOKENS)) {
      if (!new RegExp(`(?<![\\w-])text-${token}(?![\\w-])`).test(src)) continue;
      add(path, {
        phase: 'gate',
        message:
          `uses \`text-${token}\` — \`--${token}\` is a SURFACE token, so this paints text in its own ` +
          `background colour (near-invisible; a shipped app measured 1.08:1 where WCAG AA needs 4.5). ` +
          `It is a real Tailwind utility, so it compiles clean and nothing else catches it. ` +
          `Use \`text-${SURFACE_TOKENS[token]}\` for text; \`bg-${token}\` is the correct use of the bare name.`,
      });
    }
  }

  const offending = Object.keys(byFile).map((path) => ({
    path,
    kind: path.startsWith('components/')
      ? 'component'
      : path.startsWith('api/')
        ? 'api'
        : path.startsWith('hooks/')
          ? 'hook'
          : 'page',
    errors: byFile[path],
  }));

  return {
    ok: build.ok && offending.length === 0,
    built: build.built,
    routes: build.routes,
    offending,
    offendingCount: offending.length,
  };
}
