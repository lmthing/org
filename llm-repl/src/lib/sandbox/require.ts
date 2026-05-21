/**
 * Host module registry for sandboxed require().
 * Provides a require() global in the QuickJS context that resolves
 * to host-provided module values.
 */
import ts from 'typescript';
import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import { marshalToQuickJS } from './host-bridge.js';

export class ModuleRegistry {
  private readonly ctx: QuickJSAsyncContext;
  private readonly modules = new Map<string, unknown>();

  constructor(ctx: QuickJSAsyncContext) {
    this.ctx = ctx;
  }

  register(name: string, value: unknown): void {
    this.modules.set(name, value);
  }

  inject(): void {
    const ctx = this.ctx;
    const modules = this.modules;

    const requireFn = ctx.newFunction('require', (nameHandle) => {
      const name = ctx.dump(nameHandle) as string;
      if (modules.has(name)) {
        return marshalToQuickJS(ctx, modules.get(name));
      }
      // Return an empty object for unknown modules rather than throwing
      return ctx.newObject();
    });

    ctx.setProp(ctx.global, 'require', requireFn);
    requireFn.dispose();
  }

  generateDeclarations(): string {
    const lines: string[] = [
      '// Auto-generated module declarations',
      'declare function require(module: string): unknown;',
    ];

    for (const name of this.modules.keys()) {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`declare module ${JSON.stringify(name)} {`);
      lines.push(`  const _exports: unknown;`);
      lines.push(`  export = _exports;`);
      lines.push(`}`);
    }

    return lines.join('\n') + '\n';
  }
}

// ── Import-to-require transformer ──

/**
 * A TypeScript TransformerFactory that rewrites ES import declarations
 * to require() calls for sandboxed execution.
 *
 * import x from 'pkg'         → const x = require('pkg')
 * import { a, b } from 'pkg'  → const { a, b } = require('pkg')
 * import * as ns from 'pkg'   → const ns = require('pkg')
 */
export function createImportToRequireTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile): ts.SourceFile => {
      function visitNode(node: ts.Node): ts.Node | ts.Node[] {
        if (!ts.isImportDeclaration(node)) {
          return ts.visitEachChild(node, visitNode, context);
        }

        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
        const requireCall = ts.factory.createCallExpression(
          ts.factory.createIdentifier('require'),
          undefined,
          [ts.factory.createStringLiteral(moduleSpecifier)],
        );

        const clause = node.importClause;
        if (!clause) {
          // Side-effect import: import 'pkg' → require('pkg')
          return ts.factory.createExpressionStatement(requireCall);
        }

        const declarations: ts.VariableDeclaration[] = [];

        if (clause.name) {
          // Default import: import x from 'pkg' → const x = require('pkg')
          declarations.push(
            ts.factory.createVariableDeclaration(clause.name, undefined, undefined, requireCall),
          );
        }

        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            // import * as ns from 'pkg' → const ns = require('pkg')
            declarations.push(
              ts.factory.createVariableDeclaration(
                clause.namedBindings.name,
                undefined,
                undefined,
                requireCall,
              ),
            );
          } else if (ts.isNamedImports(clause.namedBindings)) {
            // import { a, b as c } from 'pkg' → const { a, b: c } = require('pkg')
            const bindingElements = clause.namedBindings.elements.map((el) => {
              if (el.propertyName) {
                return ts.factory.createBindingElement(undefined, el.propertyName, el.name);
              }
              return ts.factory.createBindingElement(undefined, undefined, el.name);
            });

            const bindingPattern = ts.factory.createObjectBindingPattern(bindingElements);
            declarations.push(
              ts.factory.createVariableDeclaration(
                bindingPattern,
                undefined,
                undefined,
                requireCall,
              ),
            );
          }
        }

        if (declarations.length === 0) {
          return ts.factory.createExpressionStatement(requireCall);
        }

        return ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList(declarations, ts.NodeFlags.Const),
        );
      }

      return ts.visitEachChild(sourceFile, (node) => {
        const result = visitNode(node);
        if (Array.isArray(result)) {
          // Can't return arrays from visitEachChild visitor; wrap in a synthetic node
          // We handle this by returning the first one — for import rewriting, each
          // import maps to exactly one statement.
          return result[0] as ts.Node;
        }
        return result as ts.Node;
      }, context) as ts.SourceFile;
    };
  };
}
