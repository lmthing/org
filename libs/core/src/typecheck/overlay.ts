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
export function extractPropsDeclaration(componentName: string, src: string): string | null {
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
    form: Record<string, string>;
  },
  onWarn?: (name: string, message: string) => void,
): string {
  const lines: string[] = [];

  // Functions: extract exported function declaration and re-emit as declare
  for (const [name, src] of Object.entries(functions)) {
    const sig = extractFunctionSignature(name, src);
    lines.push(sig);
    if (onWarn) warnIfMissingAnnotations('function', name, src, onWarn);
  }

  // Components — view and form are both single-file sources now.
  const allComponents: Record<string, string> = { ...components.view, ...components.form };

  for (const [name, src] of Object.entries(allComponents)) {
    const propsDecl = extractPropsDeclaration(name, src);
    if (propsDecl) {
      lines.push(propsDecl);
      lines.push(`declare function ${name}(props: ${name}Props): JSXDescriptor;`);
    } else {
      lines.push(`declare function ${name}(props?: Record<string, unknown>): JSXDescriptor;`);
    }
    if (onWarn) warnIfMissingAnnotations('component', name, src, onWarn);
  }

  return lines.join('\n');
}

/**
 * Best-effort check: warn (do not throw) when a space function or component
 * lacks a JSDoc comment or any type annotations on its parameters. Mirrors the
 * existing best-effort injection behavior (one bad/under-annotated item logs a
 * warning, the rest still proceed).
 */
function warnIfMissingAnnotations(
  kind: 'function' | 'component',
  name: string,
  src: string,
  onWarn: (name: string, message: string) => void,
): void {
  const sf = ts.createSourceFile(kind === 'component' ? 'comp.tsx' : 'fn.ts', src, ts.ScriptTarget.ESNext, true, kind === 'component' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  let node: ts.FunctionDeclaration | undefined;
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && (stmt.name?.text === name || (kind === 'component' && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)))) {
      node = stmt;
      break;
    }
  }
  if (!node) {
    onWarn(name, `could not locate a function declaration for "${name}" to verify JSDoc/type annotations`);
    return;
  }

  const jsDocs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  const hasDoc = jsDocs.some((j) => (j.comment ?? '').toString().trim().length > 0);
  if (!hasDoc) {
    onWarn(name, `${kind} "${name}" has no JSDoc description — the model won't see what it does`);
  }

  const untypedParams = node.parameters.filter((p) => !p.type && !(kind === 'component' && ts.isObjectBindingPattern(p.name)));
  if (untypedParams.length > 0) {
    onWarn(name, `${kind} "${name}" has untyped parameter(s) — add explicit TypeScript type annotations`);
  }
}

/**
 * Extract a component's JSDoc description from its default (or named, matching
 * `name`) export function declaration. Mirrors how function tools surface their
 * JSDoc in the system block (see `extractToolSummary` in context/system-block.ts).
 * Returns '' when no JSDoc comment is present.
 */
export function extractComponentDoc(name: string, src: string): string {
  const sf = ts.createSourceFile('comp.tsx', src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

  for (const node of sf.statements) {
    if (
      ts.isFunctionDeclaration(node) &&
      (node.name?.text === name || node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
    ) {
      const jsDocs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
      const commentParts = jsDocs.map((j) => (j.comment ?? '').toString().trim()).filter(Boolean);
      if (commentParts.length > 0) return commentParts.join(' ');
      break;
    }
  }

  // Fallback: a leading line comment directly above the export.
  return src.match(/^\s*\/\/\s*(.+)$/m)?.[1]?.trim() ?? '';
}

/**
 * Strip `import { X, Y } from '@lmthing/...'` lines that reference catalog
 * component names before eval/transpile — mirrors the export-stripping in
 * `sandbox/inject-functions.ts`. Authored space components now import catalog
 * components (`import { Stack } from '@lmthing/ui'`) for editor ergonomics, but
 * at runtime the catalog names are plain globals injected on the VM, so the
 * import line must be removed rather than resolved as a real module.
 *
 * NOTE: core never evaluates component *source* directly (component files are
 * only read for AST extraction — Props/JSDoc — here and in system-block.ts;
 * rendering happens host-side in the CLI/UI renderers from JSXDescriptor data).
 * This helper exists for callers (e.g. a future bundler/renderer) that DO eval
 * component source, so the stripping logic has one canonical home.
 */
export function stripCatalogImports(src: string, catalogNames: ReadonlySet<string>): string {
  return src.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]@lmthing\/[^'"]+['"]\s*;?\s*$/gm, (full, names: string) => {
    const kept = names
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && !catalogNames.has(n.replace(/\s+as\s+\S+$/, '').trim()));
    return kept.length > 0 ? `import { ${kept.join(', ')} } from '@lmthing/stripped';` : '';
  });
}

/**
 * Extract exported function signature from source as a declare statement,
 * prepending any local interface/type-alias declarations so that parameter
 * types referencing them resolve correctly in the ambient DTS overlay.
 */
export function extractFunctionSignature(name: string, src: string): string {
  const sf = ts.createSourceFile('fn.ts', src, ts.ScriptTarget.ESNext, true);
  const parts: string[] = [];

  // Collect local interface and type-alias declarations. They may be referenced
  // by the function's parameter types (e.g. `spec: TaskFileSpec`) and must
  // appear in the ambient DTS for the TypeScript checker to resolve them.
  for (const node of sf.statements) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      // Slice the raw source text (getStart skips leading trivia/comments)
      const text = src.slice(node.getStart(sf), node.end).trim();
      // Strip any leading export/declare keywords — in ambient context they're implicit
      parts.push(text.replace(/^(?:export\s+)?(?:declare\s+)?/, ''));
    }
  }

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
      // A missing return type defaults to `any` (not `unknown`): the model often omits
      // the annotation, and `unknown` would force every `result.field` access to fail
      // typecheck and burn a retry. `any` lets callers read the result directly.
      const retType = node.type ? src.slice(node.type.pos, node.type.end).trim() : 'any';
      const asyncKw = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
      parts.push(`declare ${asyncKw}function ${name}(${params}): ${retType};`);
      return parts.join('\n');
    }
  }

  // Fallback: declare with a permissive any return so callers can use the result.
  parts.push(`declare function ${name}(...args: unknown[]): any;`);
  return parts.join('\n');
}
