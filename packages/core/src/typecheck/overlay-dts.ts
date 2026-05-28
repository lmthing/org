import ts from 'typescript';

/**
 * Build an ambient .d.ts overlay from a map of function source strings.
 * Each source is transpiled to a declaration and rewritten to be ambient
 * (no imports, declare instead of export).
 */
export function buildOverlay(functionSources: Record<string, string>): string {
  const parts: string[] = [];

  for (const [name, source] of Object.entries(functionSources)) {
    try {
      const result = ts.transpileDeclaration(source, {
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
        },
        fileName: `${name}.ts`,
      });
      if (result.outputText) {
        parts.push(rewriteToAmbient(result.outputText));
      }
    } catch {
      // Skip sources that fail to transpile
    }
  }

  return parts.join('\n');
}

/**
 * Convert a module .d.ts to ambient declarations:
 * - Strip import lines
 * - `export declare function` → `declare function`
 * - `export declare class` → `declare class`
 * - `export interface` → `declare interface` (or `interface`)
 * - `export type` → `type`
 * - Drop bare `export { ... }` statements
 * - Drop `export default`
 */
function rewriteToAmbient(dts: string): string {
  return dts
    .split('\n')
    .map((line) => {
      // Remove import lines
      if (/^\s*import\s/.test(line)) return '';
      // Drop bare export { ... } statements
      if (/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line)) return '';
      // Drop export default
      if (/^\s*export\s+default\s/.test(line)) return '';
      // export declare → declare
      line = line.replace(/^(\s*)export\s+declare\s+/, '$1declare ');
      // export interface → declare interface
      line = line.replace(/^(\s*)export\s+interface\s+/, '$1declare interface ');
      // export type → type (keep as-is but remove export keyword)
      line = line.replace(/^(\s*)export\s+type\s+/, '$1type ');
      // export abstract class → declare abstract class
      line = line.replace(/^(\s*)export\s+abstract\s+class\s+/, '$1declare abstract class ');
      // export class → declare class
      line = line.replace(/^(\s*)export\s+class\s+/, '$1declare class ');
      // export function → declare function
      line = line.replace(/^(\s*)export\s+function\s+/, '$1declare function ');
      // export const/let/var → declare const/let/var
      line = line.replace(/^(\s*)export\s+(const|let|var)\s+/, '$1declare $2 ');
      // export enum → declare enum
      line = line.replace(/^(\s*)export\s+enum\s+/, '$1declare enum ');
      return line;
    })
    .filter((line) => line !== null)
    .join('\n');
}
