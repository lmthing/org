/**
 * Auto-discover a space's `.d.ts` overlay from its on-disk `functions/` and
 * `components/{view,form}/` directories.
 *
 * For each function/component source file, emit a global ambient declaration
 * matching its exported signature, using TypeScript's `transpileDeclaration`
 * to extract the real types (no manual signature maintenance).
 *
 * The overlay layers on top of the library's `.d.ts` (see {@link LIBRARY_AMBIENT_DTS})
 * to form the complete ambient surface that runTsc's sessionContext sees.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import ts from 'typescript';

export interface ExtractOverlayDtsOpts {
  /** Absolute path to the space root. */
  spaceDir: string;
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  declaration: true,
  emitDeclarationOnly: true,
  skipLibCheck: true,
  strict: false,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: 'react',
};

interface ExtractedDecl {
  /** Original file relative to spaceDir, e.g. "functions/webSearch.ts" */
  path: string;
  /** The exported identifier whose declaration we surfaced (e.g. "webSearch"). */
  name: string;
  /** Generated declaration block ready to splice into the overlay. */
  declaration: string;
}

/**
 * Extract `.d.ts` declarations from a single TypeScript source string.
 *
 * Uses `ts.transpileDeclaration` (TS 5.5+) which is fast and avoids spinning
 * up a full Program. Returns the raw `.d.ts` text. The caller is responsible
 * for converting `export` statements into ambient `declare` form if needed.
 */
function transpileToDts(source: string, fileName: string): string {
  // transpileDeclaration takes input text + a file name; returns .d.ts text.
  const result = ts.transpileDeclaration(source, {
    fileName,
    compilerOptions: COMPILER_OPTIONS,
    reportDiagnostics: false,
  });
  return result.outputText;
}

/**
 * Convert the per-file `.d.ts` output (which uses `export function`/`export const`)
 * into ambient declarations the QuickJS sandbox sees as globals.
 *
 * Strategy:
 *   - Drop `import` statements (the sandbox doesn't resolve them).
 *   - Replace `export declare function X` → `declare function X`.
 *   - Replace `export declare const X` → `declare const X`.
 *   - Replace `export interface X` → `declare interface X`.
 *   - Replace `export type X` → `declare type X`.
 *   - Drop bare `export {}` / `export {...}` re-export lines.
 *   - Drop `export ` prefix on `class`, `enum`, etc.
 */
function rewriteToAmbient(dtsText: string): string {
  return dtsText
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .filter((line) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line))
    .map((line) => {
      // `export declare function foo` → `declare function foo`
      line = line.replace(/^(\s*)export\s+declare\s+/, '$1declare ');
      // `export declare class Foo` → already handled by line above
      // `export function foo` (non-declare form, e.g. from .ts that wasn't using declare) → `declare function foo`
      line = line.replace(/^(\s*)export\s+(function|const|let|var|class|enum|interface|type|namespace)\b/, '$1declare $2');
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function safeRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function extractFromDir(
  dir: string,
  exts: string[],
  pathPrefix: string,
): Promise<ExtractedDecl[]> {
  const out: ExtractedDecl[] = [];
  const files = await safeReadDir(dir);
  for (const file of files) {
    const ext = extname(file);
    if (!exts.includes(ext)) continue;
    const source = await safeRead(join(dir, file));
    if (source === undefined) continue;
    const name = basename(file, ext);
    let dts: string;
    try {
      dts = transpileToDts(source, file);
    } catch {
      // Fallback: a minimal stub if the file fails to transpile.
      dts = ext === '.tsx'
        ? `export declare const ${name}: (props?: Record<string, unknown>) => unknown;`
        : `export declare function ${name}(...args: unknown[]): unknown;`;
    }
    const declaration = rewriteToAmbient(dts);
    if (declaration.length > 0) {
      out.push({ path: `${pathPrefix}/${file}`, name, declaration });
    }
  }
  return out;
}

export interface OverlayDtsResult {
  /** Concatenated ambient `.d.ts` text — splice into runTsc's sessionContext. */
  dts: string;
  /** Per-file declarations, for inspection/debugging. */
  decls: ExtractedDecl[];
}

/**
 * Walk a space's `functions/`, `components/view/`, and `components/form/`
 * directories and emit a single ambient overlay `.d.ts`.
 *
 * The overlay does NOT include the library's primitive declarations — see
 * {@link LIBRARY_AMBIENT_DTS} for those. Compose both for the full surface
 * passed to runTsc.
 */
export async function extractOverlayDts(opts: ExtractOverlayDtsOpts): Promise<OverlayDtsResult> {
  const { spaceDir } = opts;

  const sections: Array<{ heading: string; decls: ExtractedDecl[] }> = [];

  const functions = await extractFromDir(join(spaceDir, 'functions'), ['.ts', '.tsx'], 'functions');
  if (functions.length > 0) sections.push({ heading: '// ── Space functions ──', decls: functions });

  const viewComponents = await extractFromDir(join(spaceDir, 'components', 'view'), ['.tsx'], 'components/view');
  if (viewComponents.length > 0) sections.push({ heading: '// ── Space view components ──', decls: viewComponents });

  const formComponents = await extractFromDir(join(spaceDir, 'components', 'form'), ['.tsx'], 'components/form');
  if (formComponents.length > 0) sections.push({ heading: '// ── Space form components ──', decls: formComponents });

  const allDecls = sections.flatMap((s) => s.decls);

  const body = sections
    .map((s) => `${s.heading}\n${s.decls.map((d) => `// ${d.path}\n${d.declaration}`).join('\n\n')}`)
    .join('\n\n');

  return { dts: body, decls: allDecls };
}
