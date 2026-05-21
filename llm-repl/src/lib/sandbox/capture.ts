/**
 * Capture rule analyzer.
 * Determines if a TypeScript statement is capturable into session space.
 */
import ts from 'typescript';

export type CaptureKind =
  | 'function'
  | 'class'
  | 'view_component'
  | 'form_component';

export interface CaptureResult {
  kind: CaptureKind;
  name: string;
  source: string;
}

export type CaptureDecision =
  | { capturable: true; result: CaptureResult }
  | { capturable: false; reason?: string };

/**
 * Analyze a complete statement and decide if it's capturable.
 */
export function analyzeCapture(source: string): CaptureDecision {
  const sf = ts.createSourceFile(
    'stmt.tsx',
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );

  if (sf.statements.length === 0) {
    return { capturable: false, reason: 'empty statement' };
  }

  const stmt = sf.statements[0];

  // ── Case 1: FunctionDeclaration ──
  if (ts.isFunctionDeclaration(stmt)) {
    if (!stmt.name) {
      return { capturable: false, reason: 'anonymous function declaration' };
    }
    const name = stmt.name.text;
    const kind = classifyFunctionLike(stmt, sf, source);
    return { capturable: true, result: { kind, name, source } };
  }

  // ── Case 2: ClassDeclaration ──
  if (ts.isClassDeclaration(stmt)) {
    if (!stmt.name) {
      return { capturable: false, reason: 'anonymous class declaration' };
    }
    const name = stmt.name.text;
    return { capturable: true, result: { kind: 'class', name, source } };
  }

  // ── Case 3: VariableStatement ──
  if (ts.isVariableStatement(stmt)) {
    const list = stmt.declarationList;

    // Must be const
    if (!(list.flags & ts.NodeFlags.Const)) {
      return {
        capturable: false,
        reason: 'use const to capture as a session-space function',
      };
    }

    // Exactly one declarator
    if (list.declarations.length !== 1) {
      return {
        capturable: false,
        reason: 'multi-declarator const is not capturable',
      };
    }

    const decl = list.declarations[0];

    // Name must be a simple identifier (no destructuring)
    if (!ts.isIdentifier(decl.name)) {
      return {
        capturable: false,
        reason: 'destructuring patterns are not capturable',
      };
    }

    const name = decl.name.text;
    const init = decl.initializer;

    if (!init) {
      return { capturable: false, reason: 'no initializer' };
    }

    // Initializer must be ArrowFunction, FunctionExpression, or ClassExpression
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      const kind = classifyFunctionLike(init, sf, source);
      return { capturable: true, result: { kind, name, source } };
    }

    if (ts.isClassExpression(init)) {
      return { capturable: true, result: { kind: 'class', name, source } };
    }

    if (ts.isCallExpression(init)) {
      return {
        capturable: false,
        reason: 'call expression initializer (HOC/factory/IIFE) is not capturable',
      };
    }

    if (ts.isObjectLiteralExpression(init)) {
      return {
        capturable: false,
        reason: 'object literal initializer is not capturable',
      };
    }

    return { capturable: false };
  }

  return { capturable: false };
}

// ── Classification helpers ──

type FunctionLikeNode =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

function classifyFunctionLike(
  node: FunctionLikeNode,
  sf: ts.SourceFile,
  source: string,
): CaptureKind {
  if (!returnsJsx(node, sf)) {
    return 'function';
  }
  // It's a component — check for submit prop
  if (hasSubmitProp(node)) {
    return 'form_component';
  }
  return 'view_component';
}

function returnsJsx(node: FunctionLikeNode, sf: ts.SourceFile): boolean {
  // Check return type annotation
  if (node.type) {
    const typeText = node.type.getText(sf);
    if (
      typeText.includes('JSX') ||
      typeText.includes('ReactElement') ||
      typeText.includes('ReactNode')
    ) {
      return true;
    }
  }

  // Walk body looking for JSX
  const body = node.body;
  if (!body) return false;

  return containsJsx(body);
}

function containsJsx(node: ts.Node): boolean {
  if (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  ) {
    return true;
  }
  return ts.forEachChild(node, containsJsx) ?? false;
}

function hasSubmitProp(node: FunctionLikeNode): boolean {
  if (node.parameters.length === 0) return false;
  const firstParam = node.parameters[0];
  const typeNode = firstParam.type;
  if (!typeNode) return false;

  // Look for a type literal with a submit property
  return hasSubmitInType(typeNode);
}

function hasSubmitInType(typeNode: ts.TypeNode): boolean {
  if (ts.isTypeLiteralNode(typeNode)) {
    for (const member of typeNode.members) {
      if (
        ts.isPropertySignature(member) &&
        member.name &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'submit' &&
        member.type &&
        isFunctionType(member.type)
      ) {
        return true;
      }
    }
  }

  // Recurse into type references that might unwrap
  // (simple heuristic: check children)
  let found = false;
  ts.forEachChild(typeNode, (child) => {
    if (!found && ts.isTypeNode(child)) {
      found = hasSubmitInType(child as ts.TypeNode);
    }
  });
  return found;
}

function isFunctionType(typeNode: ts.TypeNode): boolean {
  return (
    ts.isFunctionTypeNode(typeNode) ||
    typeNode.kind === ts.SyntaxKind.FunctionType
  );
}
