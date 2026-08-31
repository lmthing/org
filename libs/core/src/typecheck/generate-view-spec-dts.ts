import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VIEW_SCHEMA_SOURCE = resolve(HERE, '../../../cli/src/app/view-spec/schema.ts');

/**
 * Emit the authoring type graph from the CLI's one source of truth. This deliberately uses the
 * TypeScript AST rather than a hand-maintained second copy: adding a field/type to schema.ts makes
 * the generated fragment change, and the snapshot test fails until the checked-in fragment is
 * regenerated.
 */
export function generateViewSpecTypes(source = readFileSync(VIEW_SCHEMA_SOURCE, 'utf8')): string {
  const sf = ts.createSourceFile(VIEW_SCHEMA_SOURCE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  const constants = new Map<string, ts.VariableDeclaration>();
  for (const statement of sf.statements) {
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) constants.set(declaration.name.text, declaration);
      }
    }
  }

  const roots = ['ViewSpec', 'ViewLayoutSpec', 'ViewComponentSpec', 'ShellSpec'];
  const selected = new Set<string>();
  const referencedNames = (node: ts.Node): string[] => {
    const names: string[] = [];
    const visit = (child: ts.Node): void => {
      if (ts.isTypeReferenceNode(child)) names.push(child.typeName.getText(sf).split('.').pop()!);
      if (ts.isTypeQueryNode(child)) names.push(child.exprName.getText(sf).split('.').pop()!);
      ts.forEachChild(child, visit);
    };
    visit(node);
    return names;
  };
  const select = (name: string): void => {
    if (selected.has(name) || !declarations.has(name)) return;
    selected.add(name);
    for (const ref of referencedNames(declarations.get(name)!)) select(ref);
  };
  roots.forEach(select);

  const literalTuple = (declaration: ts.VariableDeclaration): string | undefined => {
    let expression = declaration.initializer;
    if (expression && ts.isAsExpression(expression)) expression = expression.expression;
    if (!expression || !ts.isArrayLiteralExpression(expression)) return undefined;
    const values = expression.elements.map((element) => element.getText(sf)).filter((x) => /^['"`]/.test(x));
    return values.length ? `readonly [${values.join(', ')}]` : undefined;
  };
  const usedConstants = new Set<string>();
  for (const name of selected) {
    for (const ref of referencedNames(declarations.get(name)!)) if (constants.has(ref)) usedConstants.add(ref);
  }

  const rendered: string[] = [];
  for (const name of selected) {
    const declaration = declarations.get(name)!;
    // Keep the declarations exactly as authored, including comments and intersections. Only the
    // module-only export modifier is removed because this text is placed in an ambient .d.ts.
    rendered.push(declaration.getText(sf).replace(/^export\s+/, ''));
  }
  for (const name of usedConstants) {
    const tuple = literalTuple(constants.get(name)!);
    if (tuple) rendered.push(`declare const ${name}: ${tuple};`);
  }

  return rendered.join('\n\n');
}

export function generatedViewSpecDts(): string {
  return `/* generated from cli/src/app/view-spec/schema.ts; do not edit */\n${generateViewSpecTypes()}`;
}

if (process.argv.includes('--write')) {
  const output = resolve(HERE, './view-spec-dts.generated.ts');
  const body = generatedViewSpecDts();
  const escaped = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(output, `export const VIEW_SPEC_TYPES = \`${escaped}\`;\n`));
}
