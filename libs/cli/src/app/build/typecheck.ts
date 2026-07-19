/**
 * Project-app **typecheck** (Phase 2 of the durability fix) — the real `tsc`
 * program {@link runProjectAppCheck} runs BEFORE ever touching esbuild.
 *
 * Before this module, there was NO typecheck of a project's `pages/`/`components/`/
 * `api/` sources — the pages build (`./pages.js`) transpiles with esbuild, which
 * strips types without checking them, so a page that doesn't even compile still
 * "builds" fine and fails silently at runtime. The tasklist prompts that promise
 * agents a "NO-DOM ambient" ("`console`/`window` are typecheck errors, catch it
 * before shipping") were describing code that didn't exist — this is that code.
 *
 * ## The ambient
 *
 * A project page/component authors against `@app/runtime` + automatic-JSX React —
 * neither of which is a real npm dependency of the PROJECT (they're aliased by
 * `./pages.js`'s esbuild config, not resolvable by a bare `tsc` run). So every
 * program built here carries one synthetic, **in-memory** ambient `.d.ts`
 * ({@link AMBIENT_DTS}) declaring:
 *   - `react` / `react/jsx-runtime` — just enough of the React surface (hooks,
 *     `ReactNode`/`FC`/`ComponentType`, the automatic-JSX factory) for a real
 *     functional component to compile, PLUS a **global** `React` namespace mirror
 *     (this codebase's own fixtures reference `React.ReactNode` as a bare type
 *     without importing `React` — see `./pages.test.ts`'s `_layout.tsx` fixture —
 *     so both the module and the global form must resolve).
 *   - a global `JSX` namespace with `IntrinsicElements: { [elem: string]: any }` —
 *     intrinsic tags (`<div>`, `<main>`, `className`, …) are deliberately untyped;
 *     this is a project-app typecheck, not a DOM-attribute linter.
 *   - `@app/runtime` — hand-matched against the REAL exports (`./runtime/client.ts`,
 *     `./runtime/hooks.tsx`, `./runtime/router.tsx`, `./runtime/chat.tsx`) so a
 *     correct call never false-positives.
 *
 * Deliberately **NOT** included: the `lib.dom.d.ts` lib. `compilerOptions.lib` is
 * `['lib.es2020.d.ts']` only — `console`/`window`/`document`/`fetch` etc. are
 * genuinely undeclared, so a page that reaches for one of them (instead of the
 * typed `@app/runtime` surface, or nothing) gets a real `Cannot find name` error.
 * This is the "NO-DOM ambient" the prompts describe.
 *
 * ## Module resolution
 *
 * A custom {@link ts.CompilerHost.resolveModuleNameLiterals} resolves ONLY
 * relative/absolute specifiers (project source) and `@app/types` (hard-mapped to
 * `<projectRoot>/types/generated.d.ts` when present) via the real filesystem;
 * every OTHER bare specifier (`react`, `@app/runtime`, a stray third-party import
 * like `react-router`) is deliberately left unresolved by the resolver and falls
 * through to the checker's ambient-module lookup. That means `react`/`@app/runtime`
 * resolve ONLY to {@link AMBIENT_DTS} — never to a real `@types/react` that might be
 * sitting in this cli package's own `node_modules` (whose DOM-touching types would
 * reintroduce the exact false positives the NO-DOM ambient exists to avoid) — and a
 * genuinely unknown import (no ambient declaration anywhere in the program) reports
 * the real "Cannot find module" diagnostic (see Test 2c below).
 */

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Dirent } from 'node:fs';
import ts from 'typescript';

import type { AppCheckError } from './check.js';

/** The three project source roots the typecheck program covers. */
const SOURCE_DIRS = ['pages', 'components', 'api'];

/** File extensions treated as project TS source. */
const TS_EXT = /\.(ts|tsx)$/;

/** Synthetic filename for the in-memory ambient — never a real file on disk. Diagnostics
 *  attributed to it (there should never be any — it's meant to compile clean) are
 *  filtered out, same as the real `generated.d.ts`. */
const AMBIENT_FILE_NAME = '__lmthing_app_ambient__.d.ts';

/**
 * The in-memory ambient `.d.ts` — see the module doc for the design rationale.
 * Hand-matched against `./runtime/client.ts`, `./runtime/hooks.tsx`,
 * `./runtime/router.tsx`, `./runtime/chat.tsx`.
 */
const AMBIENT_DTS = `
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare namespace JSX {
  interface IntrinsicElements { [elem: string]: any }
  interface Element {}
  interface ElementClass { render?(): any }
  interface ElementAttributesProperty { props: {}; }
  interface ElementChildrenAttribute { children: {}; }
  // 'key'/'ref' are React-reserved attributes consumed by React itself, not part of
  // a component's own props — unioned into every JSX element's allowed attributes
  // (mirrors @types/react) so \`<CostCard key={id} />\` never false-positives as an
  // excess/unknown property just because \`CostCardProps\` doesn't declare \`key\`.
  interface IntrinsicAttributes { key?: React.Key | null | undefined }
  interface IntrinsicClassAttributes<T> { ref?: any }
}

/** Global mirror of the 'react' module surface — project fixtures reference
 *  \`React.ReactNode\` etc. as a bare type without an \`import React\` (automatic
 *  JSX never requires one at runtime), so both forms must resolve. */
declare namespace React {
  type Key = string | number;
  interface ReactElement { type: any; props: any; key: Key | null }
  type ReactNode = any;
  interface CSSProperties { [key: string]: string | number | undefined }
  interface FC<P = {}> {
    (props: P): ReactElement | null;
  }
  type ComponentType<P = {}> = FC<P> | (new (props: P) => Component<P, any>);
  type AnchorHTMLAttributes<T = any> = { [key: string]: any };
  type ButtonHTMLAttributes<T = any> = { [key: string]: any };
  type InputHTMLAttributes<T = any> = { [key: string]: any };
  type FormEvent<T = any> = { [key: string]: any; preventDefault(): void };
  type ChangeEvent<T = any> = { [key: string]: any; target: any };
  type MouseEvent<T = any> = { [key: string]: any };
  type KeyboardEvent<T = any> = { key: string; shiftKey: boolean; preventDefault(): void; [k: string]: any };
  class Component<P = {}, S = {}> {
    constructor(props: P);
    props: P;
    state: S;
    setState(update: Partial<S> | ((prevState: S, props: P) => Partial<S> | null), callback?: () => void): void;
    render(): ReactNode;
  }
}

declare module 'react' {
  export type Key = React.Key;
  export type ReactElement = React.ReactElement;
  export type ReactNode = React.ReactNode;
  export type CSSProperties = React.CSSProperties;
  export type FC<P = {}> = React.FC<P>;
  export type ComponentType<P = {}> = React.ComponentType<P>;
  export type AnchorHTMLAttributes<T = any> = React.AnchorHTMLAttributes<T>;
  export type ButtonHTMLAttributes<T = any> = React.ButtonHTMLAttributes<T>;
  export type InputHTMLAttributes<T = any> = React.InputHTMLAttributes<T>;
  export type FormEvent<T = any> = React.FormEvent<T>;
  export type ChangeEvent<T = any> = React.ChangeEvent<T>;
  export type MouseEvent<T = any> = React.MouseEvent<T>;
  export type KeyboardEvent<T = any> = React.KeyboardEvent<T>;
  export class Component<P = {}, S = {}> extends React.Component<P, S> {}

  export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
  export function useState<S = undefined>(): [S | undefined, (value: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T = undefined>(): { current: T | undefined };
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export interface Context<T> {
    Provider: ComponentType<{ value: T; children?: ReactNode }>;
    Consumer: ComponentType<{ children: (value: T) => ReactNode }>;
  }
  export function useContext<T>(context: Context<T>): T;
  export function createContext<T>(defaultValue: T): Context<T>;
  export function createElement(...args: any[]): ReactElement;
  export const Fragment: unique symbol;

  const ReactDefault: {
    createElement: typeof createElement;
    Fragment: typeof Fragment;
    Component: typeof Component;
  };
  export default ReactDefault;
}

declare module '@app/runtime' {
  export class HttpError extends Error {
    status: number;
    details?: unknown;
  }

  export interface UseApiOptions {
    enabled?: boolean;
  }
  export interface QueryResult<T> {
    data: T | undefined;
    error: HttpError | undefined;
    isLoading: boolean;
    refetch: () => void;
  }
  export function useApi<T = unknown>(
    name: string,
    input?: Record<string, unknown>,
    opts?: { enabled?: boolean },
  ): { data: T | undefined; error: HttpError | undefined; isLoading: boolean; refetch: () => void };

  export function useApiMutation<T = unknown>(
    name: string,
    opts?: { invalidates?: string[] },
  ): { mutate: (input?: Record<string, unknown>) => Promise<T>; isPending: boolean; error: HttpError | undefined };

  export function apiCall(name: string, input?: Record<string, unknown>): Promise<unknown>;

  export function useParams(): Record<string, string>;

  export const Link: (props: { to: string; href?: string; children?: any; className?: string; [k: string]: any }) => any;

  export function navigate(to: string): void;

  export const Chat: (props: { agent: string; [k: string]: any }) => any;
}
`;

/** Compiler options for the project-app typecheck program — see the module doc. */
function compilerOptions(): ts.CompilerOptions {
  return {
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: 'react',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2020,
    lib: ['lib.es2020.d.ts'],
    strict: true,
    skipLibCheck: true,
    noImplicitAny: false,
    types: [],
  };
}

/** Recursively collect `.ts`/`.tsx` files under `dir` (absolute paths); `[]` if `dir` is absent.
 *  Skips dotted dirs (`.data/`, …) and `node_modules`. */
async function collectSourceFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectSourceFiles(abs)));
      continue;
    }
    if (entry.isFile() && TS_EXT.test(entry.name)) out.push(abs);
  }
  return out;
}

/** Project-relative, forward-slash path. */
function toProjectRelative(projectRoot: string, absPath: string): string {
  return relative(projectRoot, absPath).split(sep).join('/');
}

/**
 * Build a {@link ts.CompilerHost} whose module resolution is deliberately narrow:
 * relative/absolute specifiers resolve against the real filesystem (project
 * source), `@app/types` hard-maps to `generatedDtsPath` (when given), and every
 * other bare specifier is left UNRESOLVED so it falls through to the checker's
 * ambient-module lookup (satisfied by {@link AMBIENT_DTS}, or reported as a real
 * "Cannot find module" when nothing ambient matches — see the module doc).
 */
function createProgramHost(
  options: ts.CompilerOptions,
  generatedDtsPath: string | undefined,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realReadFile = host.readFile.bind(host);
  const realFileExists = host.fileExists.bind(host);

  host.fileExists = (fileName) => (fileName === AMBIENT_FILE_NAME ? true : realFileExists(fileName));
  host.readFile = (fileName) => (fileName === AMBIENT_FILE_NAME ? AMBIENT_DTS : realReadFile(fileName));
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (fileName === AMBIENT_FILE_NAME) {
      return ts.createSourceFile(AMBIENT_FILE_NAME, AMBIENT_DTS, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    }
    return realGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
  };

  host.resolveModuleNameLiterals = (moduleLiterals, containingFile, redirectedReference, resolveOptions) => {
    return moduleLiterals.map((literal) => {
      const text = literal.text;
      if (text === '@app/types' && generatedDtsPath) {
        return {
          resolvedModule: {
            resolvedFileName: generatedDtsPath,
            extension: ts.Extension.Dts,
            isExternalLibraryImport: false,
          },
        };
      }
      if (text.startsWith('.') || text.startsWith('/') || isAbsolute(text)) {
        const result = ts.resolveModuleName(
          text,
          containingFile,
          resolveOptions,
          host,
          undefined,
          redirectedReference,
        );
        return { resolvedModule: result.resolvedModule };
      }
      // Every other bare specifier ('react', '@app/runtime', a stray third-party
      // import) is left unresolved — the checker falls back to an ambient `declare
      // module` match (AMBIENT_DTS) or reports "Cannot find module".
      return { resolvedModule: undefined };
    });
  };

  return host;
}

/**
 * Typecheck a project's `pages/`/`components/`/`api/` sources against the
 * `@app/runtime` + automatic-JSX-React ambient (see the module doc). Returns one
 * {@link AppCheckError} (`phase:'typecheck'`) per diagnostic in the project's OWN
 * source — diagnostics inside the synthetic ambient or the generated `.d.ts` are
 * dropped (they are build-generated, never author-fixable).
 */
export async function typecheckProjectApp(projectRoot: string): Promise<AppCheckError[]> {
  const sourceFiles = (
    await Promise.all(SOURCE_DIRS.map((d) => collectSourceFiles(join(projectRoot, d))))
  ).flat();

  const generatedDtsPath = join(projectRoot, 'types', 'generated.d.ts');
  const hasGeneratedDts = existsSync(generatedDtsPath);

  // Nothing to typecheck (no pages/components/api at all) — a db/api-only or
  // spaces-only project has no project-app source.
  if (sourceFiles.length === 0) return [];

  const rootNames = [
    AMBIENT_FILE_NAME,
    ...(hasGeneratedDts ? [generatedDtsPath] : []),
    ...sourceFiles,
  ];

  const options = compilerOptions();
  const host = createProgramHost(options, hasGeneratedDts ? generatedDtsPath : undefined);
  const program = ts.createProgram({ rootNames, options, host });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  const errors: AppCheckError[] = [];

  for (const diag of diagnostics) {
    if (!diag.file) continue; // a global (non-file) diagnostic — nothing author-fixable to point at
    const fileName = diag.file.fileName;
    if (fileName === AMBIENT_FILE_NAME || fileName === generatedDtsPath) continue;

    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    if (diag.start === undefined) {
      errors.push({ phase: 'typecheck', file: toProjectRelative(projectRoot, fileName), message });
      continue;
    }
    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
    errors.push({
      phase: 'typecheck',
      file: toProjectRelative(projectRoot, fileName),
      line: line + 1,
      column: character + 1,
      message,
    });
  }

  return errors;
}
