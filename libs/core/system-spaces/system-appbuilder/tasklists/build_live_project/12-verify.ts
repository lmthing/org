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
  dependsOn: ['implement_tables', 'implement_endpoints', 'implement_components', 'implement_pages'],
  output: {
    ok: 'boolean',
    built: 'boolean',
    routes: 'array',
    offending: 'array',
    offendingCount: 'number',
  },
};

interface Ctx {
  buildProjectApp: () => Promise<{
    ok: boolean;
    built: boolean;
    routes: string[];
    errors: Array<{ phase: string; file: string; line?: number; column?: number; message: string }>;
  }>;
  listProjectDir: (dir: string) => { ok: boolean; entries: string[]; error?: string };
  readProjectFile: (path: string) => { ok: boolean; content: string; error?: string };
}

interface Finding {
  line?: number;
  phase: string;
  message: string;
}

/** Every `.ts`/`.tsx` file under `dir`, walked breadth-first. */
function walkFiles(ctx: Ctx, dir: string): string[] {
  const out: string[] = [];
  const queue = (ctx.listProjectDir(dir).entries || []).map((n) => `${dir}/${n}`);
  while (queue.length > 0) {
    const p = queue.shift() as string;
    if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
      continue;
    }
    for (const child of ctx.listProjectDir(p).entries || []) queue.push(`${p}/${child}`);
  }
  return out;
}

function read(ctx: Ctx, path: string): string {
  return ctx.readProjectFile(path).content || '';
}

/** Endpoint names the project's `api/` actually exports, with the route params each needs. */
function realEndpoints(ctx: Ctx): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const path of walkFiles(ctx, 'api')) {
    const src = read(ctx, path);
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
function realTables(ctx: Ctx): string[] {
  return (ctx.listProjectDir('database').entries || [])
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

export async function run(ctx: Ctx, _inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const build = await ctx.buildProjectApp();
  const byFile: Record<string, Finding[]> = {};
  const add = (file: string, f: Finding): void => {
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };

  for (const e of build.errors) {
    add(e.file, { line: e.line, phase: e.phase, message: e.message });
  }

  const endpoints = realEndpoints(ctx);
  const endpointNames = [...endpoints.keys()];
  const tables = realTables(ctx);
  const known = endpointNames.length > 0 ? endpointNames.join(', ') : 'none';

  // (1) An api module querying a table that does not exist. The db surface is dynamically
  // typed, so this builds CLEAN and 500s on every call — as broken as an unresolved import.
  for (const path of walkFiles(ctx, 'api')) {
    const src = read(ctx, path);
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

  // (2)+(3)+(4) Client-side scans over pages/ and components/.
  for (const path of [...walkFiles(ctx, 'pages'), ...walkFiles(ctx, 'components')]) {
    const src = read(ctx, path);

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
    kind: path.startsWith('components/') ? 'component' : path.startsWith('api/') ? 'api' : 'page',
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
