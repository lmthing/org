/**
 * SAVE-TIME partial typecheck for the project-app writers (`writeProjectPage`/
 * `writeProjectComponent`/`writeProjectApi` in `./globals.ts`).
 *
 * ## Why a second typecheck exists
 *
 * The whole-app typecheck ({@link typecheckProjectApp}) runs at `appCheck` time — after the
 * appbuilder tasklist has authored many files — and the verify/fix loop that consumes it does not
 * reliably converge on type-level faults. Run 34 of the 06-tanzania scenario shipped an app that
 * never rendered because five type errors escaped to `appCheck` and the fix node could not repair
 * them across its whole budget: a handler used `apiHandler` (should be `handler`), a page did
 * `data.items` on an untyped `useApi`, and a page called `.mutateAsync(...)`/`.isLoading` on a
 * `useApiMutation` result that only has `{ mutate, isPending, error }`. Every one is checkable
 * against the ambient alone — none needs a sibling body or an endpoint impl — so catching them in
 * the WRITER means the model fixes them in the SAME turn, holding the file's full context (the user
 * directive: prefer write-time feedback; see `./lint.ts`).
 *
 * ## Two tiers — this is the SAVE tier: a single-file mirror of `appCheck`, one tolerance added
 *
 * The build pipeline is deterministic and ordered: `emit_types` (node 09) writes the GLOBAL-ambient
 * `types/contract.d.ts`, then tables, then endpoints (node 12), then components (node 14, a
 * `forEach`), then pages (node 15). So when a page or endpoint is written its endpoints ALREADY
 * exist. This check therefore mirrors `appCheck` as closely as a single-file program can:
 *
 *   - **Narrowed data hooks, always.** The ambient uses this project's own endpoint-name overloads
 *     ({@link buildClientApiDts}) whenever it HAS endpoints, exactly as {@link typecheckProjectApp}
 *     does — so a page naming an endpoint that does not exist, or a `[id]` route called without its
 *     param, is a HARD error at save (the original costs-summary dead-endpoint defect). Only a
 *     project with no endpoints at all keeps the builder's own generic fallback ({@link
 *     buildClientApiDts} returns `''` → {@link GENERIC_DATA_HOOKS}).
 *   - **`contract.d.ts` / `generated.d.ts` are loaded as roots**, same as `appCheck`, so a page's
 *     bare-global contract type (`useApi<CostLinesOutput>('cost-lines')` — `contract.d.ts` is a
 *     no-export SCRIPT, referenced with NO import) resolves instead of erroring.
 *   - **The ONE added tolerance: unresolved relative sibling imports are stubbed as `any`.**
 *     Components are authored in a `forEach` where component A may import component-B-not-yet-written;
 *     a page may reference a component authored moments later. So every relative import is resolved
 *     to a synthetic module whose named bindings are `any` (value AND type), keeping the check
 *     strictly single-file — cross-component prop agreement stays an `appCheck` concern. `node:*`
 *     builtins are stubbed the same way (a handler legitimately reaches for them and `./lint.ts`
 *     sanctions it, though the bare `tsc` program does not resolve them).
 *
 * Net: the ONLY diagnostics that surface are the file's OWN faults — `Cannot find name
 * 'apiHandler'`, `.mutateAsync`/`.isLoading` on a mutation, a property access on an `unknown`
 * `useApi` result, an unknown endpoint name, an orphaned `as const` — never a not-yet-written
 * sibling and never a not-yet-implemented endpoint body.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import ts from 'typescript';

import { buildAmbientDts, compilerOptions, GENERIC_DATA_HOOKS } from '../build/typecheck.js';
import { buildClientApiDts } from '../build/apicall-dts.js';
import { discoverApiEndpoints } from './lint.js';

/** One save-time type diagnostic in the file being written. */
export interface SaveTypeDiag {
  /** Project-relative path of the file being written (e.g. `pages/gallery.tsx`). */
  file: string;
  line?: number;
  column?: number;
  message: string;
}

/** Synthetic in-memory ambient filename — never a real file on disk. */
const AMBIENT_FILE = '__lmthing_save_ambient__.d.ts';
/** Prefix for the per-specifier synthetic stub files (also never on disk). */
const STUB_PREFIX = '__lmthing_save_stub__';

/** A relative/absolute-path specifier (a project sibling). */
function isRelative(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/') || isAbsolute(spec);
}

/**
 * The exported names an import/re-export statement pulls from each STUBBED specifier (a relative
 * sibling or a `node:*` builtin), so the synthetic stub can export exactly those — as `any`, in BOTH
 * value and type space (a page may use `import type { Row }` in a type position and `import { helper }`
 * as a value). A default import always gets a default export; a namespace import (`import * as X`) has
 * no statically-known members and is typed through the stub's default `any`.
 */
function stubbedImportNames(src: string, hasGeneratedDts: boolean): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const sf = ts.createSourceFile('__scan__.tsx', src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const isStubbed = (spec: string): boolean =>
    isRelative(spec) || spec.startsWith('node:') || (spec === '@app/types' && !hasGeneratedDts);
  const record = (spec: string, names: Iterable<string>): void => {
    if (!isStubbed(spec)) return;
    const set = out.get(spec) ?? new Set<string>();
    for (const n of names) set.add(n);
    out.set(spec, set);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const names: string[] = [];
      const bindings = st.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
      }
      record(st.moduleSpecifier.text, names);
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const names: string[] = [];
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) names.push((el.propertyName ?? el.name).text);
      }
      record(st.moduleSpecifier.text, names);
    }
  }
  return out;
}

/** The `.d.ts` text for a stub: a default `any` plus each requested name as an `any` value AND an
 *  `any` type (so it satisfies value-, type- and `import type`-position uses). */
function stubDts(names: Set<string>): string {
  const lines = ['declare const _d: any;', 'export default _d;'];
  for (const n of names) {
    lines.push(`export const ${n}: any;`);
    lines.push(`export type ${n} = any;`);
  }
  return lines.join('\n');
}

/** Save-time compiler options: the SAME base as the whole-app {@link typecheckProjectApp} (shared, so
 *  the two tiers cannot drift on lib/target/strictness) plus `esModuleInterop`/`allowSyntheticDefaultImports`
 *  so a default/namespace import of a stub resolves as `any`. */
function saveCompilerOptions(): ts.CompilerOptions {
  return { ...compilerOptions(), esModuleInterop: true, allowSyntheticDefaultImports: true };
}

/**
 * The default-lib source files (`lib.es2020.d.ts` and its references) are constant across every
 * save, but parsing them is the only non-trivial cost of a single-file program. Cache them
 * module-wide keyed by filename so the 2nd+ save reuses the parsed AST. The ambient/main/stub/
 * contract files are cheap and always re-read (they change per call/project).
 */
const libFileCache = new Map<string, ts.SourceFile>();

function scriptKindFor(fileName: string): ts.ScriptKind {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Typecheck ONE just-authored project-app file against the save-time ambient (see the module doc).
 * `relPath` is the project-relative path it WILL land at (e.g. `pages/gallery.tsx`) — used both to
 * root relative imports and to label the diagnostic; `src` is the in-memory source (nothing has been
 * written to disk yet). Returns the FIRST diagnostic in the file itself, or `null` when it is clean.
 */
export function saveTypecheckFile(opts: {
  projectRoot: string;
  relPath: string;
  src: string;
}): SaveTypeDiag | null {
  const { projectRoot, relPath, src } = opts;

  // Narrow the data hooks to THIS project's endpoints (the pipeline authors endpoints before the
  // pages that read them) — identical to typecheckProjectApp; the generic form is used only when the
  // project has no endpoints yet (buildClientApiDts returns '').
  const endpoints = discoverApiEndpoints(projectRoot);
  // `buildClientApiDts` returns '' for an endpoint-less project, so the `|| GENERIC` fallback alone
  // covers both cases — same selection as typecheckProjectApp.
  const dataHooks =
    buildClientApiDts([...endpoints.values()].map((ep) => ({ name: ep.name, paramNames: ep.paramNames }))) ||
    GENERIC_DATA_HOOKS;
  const ambientDts = buildAmbientDts(dataHooks);

  // The same GLOBAL contract roots appCheck loads: `contract.d.ts` (no-export ambient script whose
  // interfaces a page/endpoint uses with NO import) and the `@app/types`-backing `generated.d.ts`.
  const generatedDtsPath = join(projectRoot, 'types', 'generated.d.ts');
  const hasGeneratedDts = existsSync(generatedDtsPath);
  const contractDtsPath = join(projectRoot, 'types', 'contract.d.ts');
  const hasContractDts = existsSync(contractDtsPath);

  const mainAbs = join(projectRoot, relPath);

  // One synthetic stub file per stubbed specifier (relative sibling / node: builtin / @app/types
  // before it is emitted), exporting its used names as `any`.
  const specToStub = new Map<string, string>();
  const overlay = new Map<string, string>([[AMBIENT_FILE, ambientDts], [mainAbs, src]]);
  let i = 0;
  for (const [spec, names] of stubbedImportNames(src, hasGeneratedDts)) {
    const fn = join(projectRoot, `${STUB_PREFIX}${i++}.d.ts`);
    specToStub.set(spec, fn);
    overlay.set(fn, stubDts(names));
  }

  const options = saveCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realReadFile = host.readFile.bind(host);
  const realFileExists = host.fileExists.bind(host);

  host.fileExists = (fileName) => (overlay.has(fileName) ? true : realFileExists(fileName));
  host.readFile = (fileName) => (overlay.has(fileName) ? overlay.get(fileName) : realReadFile(fileName));
  host.getSourceFile = (fileName, langVersion, onError, shouldCreate) => {
    const inline = overlay.get(fileName);
    if (inline !== undefined) {
      return ts.createSourceFile(fileName, inline, ts.ScriptTarget.ES2020, true, scriptKindFor(fileName));
    }
    const cached = libFileCache.get(fileName);
    if (cached) return cached;
    const sf = realGetSourceFile(fileName, langVersion, onError, shouldCreate);
    if (sf && /lib\.[^/\\]*\.d\.ts$/.test(fileName)) libFileCache.set(fileName, sf);
    return sf;
  };

  host.resolveModuleNameLiterals = (literals, containingFile, redirected, resolveOptions) =>
    literals.map((literal) => {
      const text = literal.text;
      // `@app/types` maps to the real generated build artifact when present (as in appCheck); before
      // it is emitted it is stubbed (see below), so an early page still saves.
      if (text === '@app/types' && hasGeneratedDts) {
        return {
          resolvedModule: {
            resolvedFileName: generatedDtsPath,
            extension: ts.Extension.Dts,
            isExternalLibraryImport: false,
          },
        };
      }
      const stub = specToStub.get(text);
      if (stub) {
        return {
          resolvedModule: { resolvedFileName: stub, extension: ts.Extension.Dts, isExternalLibraryImport: false },
        };
      }
      // Any other relative import (unusual — all are stubbed above) resolves on the real fs; every
      // other bare specifier (`@app/runtime`, `react`) is left unresolved to match the ambient
      // `declare module`, or to report a genuine Cannot-find-module.
      if (isRelative(text)) {
        const r = ts.resolveModuleName(text, containingFile, resolveOptions, host, undefined, redirected);
        return { resolvedModule: r.resolvedModule };
      }
      return { resolvedModule: undefined };
    });

  const rootNames = [
    AMBIENT_FILE,
    ...(hasGeneratedDts ? [generatedDtsPath] : []),
    ...(hasContractDts ? [contractDtsPath] : []),
    mainAbs,
  ];
  const program = ts.createProgram({ rootNames, options, host });

  for (const diag of ts.getPreEmitDiagnostics(program)) {
    if (!diag.file || diag.file.fileName !== mainAbs) continue; // only the file being written
    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    if (diag.start === undefined) return { file: relPath, message };
    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
    return { file: relPath, line: line + 1, column: character + 1, message };
  }
  return null;
}

/**
 * Human-readable save-time type error, or `null` when the file typechecks. Formatted like the lint
 * messages in `./lint.ts` so the authoring model reads one consistent "rejected (not saved)" voice
 * and fixes it in the same turn.
 */
export function saveTypecheckError(opts: {
  projectRoot: string;
  relPath: string;
  src: string;
  kind: 'page' | 'component' | 'api endpoint';
}): string | null {
  const diag = saveTypecheckFile(opts);
  if (!diag) return null;
  const at = diag.line ? ` (${diag.file}:${diag.line}:${diag.column})` : ` (${diag.file})`;
  // The hook-shape hint is noise on an unrelated diagnostic (a bad JSX prop, `Cannot find name
  // 'apiHandler'`), so it rides only a diagnostic that actually concerns the data hooks.
  const hookHint = /useApi|useApiMutation|mutate|isPending|QueryResult|unknown/.test(diag.message)
    ? ' `useApi(...)` returns `{ data, isLoading, error, refetch }` and `useApiMutation(...)` returns ' +
      '`{ mutate, isPending, error }` (no `mutateAsync`/`isLoading` on a mutation), and an untyped ' +
      '`useApi(...)` result is `unknown` — pass a generic (`useApi<{ items: Row[] }>(...)`) before reading a field.'
    : '';
  return (
    `${opts.kind} rejected (not saved): type error${at} — ${diag.message}. This is a partial typecheck ` +
    `against the app ambient (React/JSX + \`@app/runtime\`, NO DOM).${hookHint} Fix the type error and re-write.`
  );
}
