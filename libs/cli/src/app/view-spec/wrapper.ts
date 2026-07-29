/**
 * **The generated wrapper page** — the design's key move, in about forty lines.
 *
 * A view spec is data, but the web target's build pipeline is a page bundler: it discovers
 * `pages/**\/*.tsx`, hashes them, bundles them and caches the result
 * (`../build/pages.ts#buildProjectPages`). Rather than teach that pipeline about a second kind of
 * page — a change that would have to reach `walkPages`, `sourceHash`, the cache, the route table
 * and the entry generator — {@link renderViewWrapper} emits a trivial `.tsx` beside each spec that
 * renders it. The pipeline sees an ordinary page. **Nothing in the build changes.**
 *
 * Three consequences worth stating, because they are the reason this is worth doing:
 *
 *  - **the spec is INLINED, not fetched** — a page app that had to fetch its own spec would show a
 *    blank frame on every cold load and would need a spec endpoint on the web target it does not
 *    otherwise need. The native target fetches (`GET /api/apps/:id/views`); the web target bundles.
 *    One renderer, two delivery paths.
 *  - **components and shell are inlined too**, which is why writing a component or the shell
 *    re-emits EVERY wrapper (`../authoring/globals.ts`). Cheap (a file write per page) and total;
 *    the alternative is tracking which page used which component and getting it wrong once.
 *  - **`BUILDER_VERSION` reaches shipped apps.** Because the wrapper is generated rather than
 *    authored, a renderer improvement is picked up by every already-built app on the next build —
 *    the retroactivity the improvement-loop ratchet depends on (plan Part 3, buckets 1 and 4).
 *
 * The import is PINNED: `@lmthing/ui/view` exporting `ViewRenderer` + `createViewClient`. It is
 * the same module the mobile app imports, which is what makes "renders natively, no WebView" a
 * property of the artifact rather than a promise.
 */

import type { ShellSpec, ViewComponentSpec, ViewSpec } from './schema.js';

/** What a wrapper needs to render its page. */
export interface WrapperInputs {
  spec: ViewSpec;
  /** Every view component the app defines, keyed by name — resolved by `{ use: … }` references. */
  components: Record<string, ViewComponentSpec>;
  /** The app shell (nav/brand/assistant), when the app declares one. */
  shell?: ShellSpec;
}

/** Inline a spec as a stable, readable object literal (2-space JSON — deterministic for the hash). */
function inline(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Render the wrapper `.tsx` for one view spec.
 *
 * Deterministic for a given input: the pages build hashes this text, so a rewrite that produced
 * cosmetically different output would rebuild every app for nothing.
 */
export function renderViewWrapper({ spec, components, shell }: WrapperInputs): string {
  return `/**
 * AUTO-GENERATED — do not edit.
 *
 * Written by \`writeProjectView\` (@lmthing/cli) from \`pages/${spec.route}.view.json\` and
 * OVERWRITTEN on every view, component or shell write. Edit the SPEC, never this file.
 *
 * It exists so the page build (\`app/build/pages.ts\`) can discover, bundle and cache a view
 * exactly as it does a hand-written page — the whole reason view specs need no pipeline changes.
 */
import { resolveAppBase } from '@app/runtime';
import { ViewRenderer, createViewClient } from '@lmthing/ui/view';

const spec = ${inline(spec)};

const components = ${inline(components)};

const shell = ${inline(shell ?? null)};

// The web target reaches endpoints by NAME through the manifest the generated entry injects
// (\`window.__APP_ENDPOINTS__\`), on the app's own base path — the same two facts \`apiCall\` uses.
// The native target builds its client from the absolute pod URL + a token instead; the renderer
// is identical either way.
const client = createViewClient({
  baseUrl: resolveAppBase((globalThis as { location?: { pathname: string } }).location?.pathname ?? '/'),
  endpoints: (globalThis as { __APP_ENDPOINTS__?: Record<string, { method: string; routePath: string }> }).__APP_ENDPOINTS__ ?? {},
});

export default function View() {
  return <ViewRenderer spec={spec} components={components} shell={shell} client={client} />;
}
`;
}
