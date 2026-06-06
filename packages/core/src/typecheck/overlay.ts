import ts from 'typescript';

/**
 * Check if a TypeScript type node is a function type (so we can make it optional,
 * since the runtime provides callbacks — the model shouldn't pass them).
 */
function isFunctionType(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false;
  return (
    ts.isFunctionTypeNode(typeNode) ||
    ts.isConstructorTypeNode(typeNode) ||
    (ts.isTypeReferenceNode(typeNode) &&
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeName.text === 'Function')
  );
}

/**
 * Extract the `interface Props { ... }` declaration from a component source,
 * renamed to `${componentName}Props`, with all function-typed members made optional.
 * Returns null if not found.
 */
function extractPropsDeclaration(componentName: string, src: string): string | null {
  const sf = ts.createSourceFile('comp.tsx', src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  for (const node of sf.statements) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Props') {
      // Make function-typed properties optional (the render surface provides them)
      const members = node.members.map((member) => {
        if (ts.isPropertySignature(member) && isFunctionType(member.type) && !member.questionToken) {
          return ts.factory.updatePropertySignature(
            member,
            member.modifiers,
            member.name,
            ts.factory.createToken(ts.SyntaxKind.QuestionToken),
            member.type,
          );
        }
        return member;
      });

      const renamed = ts.factory.updateInterfaceDeclaration(
        node,
        node.modifiers,
        ts.factory.createIdentifier(`${componentName}Props`),
        node.typeParameters,
        node.heritageClauses,
        members,
      );
      return printer.printNode(ts.EmitHint.Unspecified, renamed, sf);
    }
  }

  return null;
}

/**
 * Build an ambient DTS overlay from the agent's functions and components.
 * - Functions: declared as async functions matching their exported signature
 * - Components: declared with their Props interface (or Record<string,unknown> fallback)
 */
export function buildOverlay(
  functions: Record<string, string>,
  components: {
    view: Record<string, string>;
    form: Record<string, { web: string; ink: string }>;
  },
): string {
  const lines: string[] = [];

  // Functions: extract exported function declaration and re-emit as declare
  for (const [name, src] of Object.entries(functions)) {
    const sig = extractFunctionSignature(name, src);
    lines.push(sig);
  }

  // Components
  const allComponents: Record<string, string> = {};
  for (const [n, s] of Object.entries(components.view)) allComponents[n] = s;
  for (const [n, { web }] of Object.entries(components.form)) allComponents[n] = web;

  for (const [name, src] of Object.entries(allComponents)) {
    const propsDecl = extractPropsDeclaration(name, src);
    if (propsDecl) {
      lines.push(propsDecl);
      lines.push(`declare function ${name}(props: ${name}Props): JSXDescriptor;`);
    } else {
      lines.push(`declare function ${name}(props?: Record<string, unknown>): JSXDescriptor;`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract exported function signature from source as a declare statement.
 */
export function extractFunctionSignature(name: string, src: string): string {
  const sf = ts.createSourceFile('fn.ts', src, ts.ScriptTarget.ESNext, true);

  for (const node of sf.statements) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const params = node.parameters
        .map((p) => {
          const paramName = ts.isIdentifier(p.name) ? p.name.text : '_';
          const typeStr = p.type ? src.slice(p.type.pos, p.type.end).trim() : 'unknown';
          const optional = p.questionToken ? '?' : '';
          return `${paramName}${optional}: ${typeStr}`;
        })
        .join(', ');
      const retType = node.type ? src.slice(node.type.pos, node.type.end).trim() : 'unknown';
      const asyncKw = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
      return `declare ${asyncKw}function ${name}(${params}): ${retType};`;
    }
  }

  // Fallback: declare as unknown return
  return `declare function ${name}(...args: unknown[]): unknown;`;
}
