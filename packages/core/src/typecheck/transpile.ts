import ts from 'typescript';

/**
 * Transpile a TypeScript/TSX statement to plain JavaScript using the classic JSX transform.
 * This strips type annotations and converts JSX to React.createElement(...) calls.
 */
export function transpileStatement(code: string): string {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
    },
    fileName: '_session.tsx',
  });
  return result.outputText;
}
