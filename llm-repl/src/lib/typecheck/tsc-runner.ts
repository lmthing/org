/**
 * In-memory tsc strict pipeline for a single statement.
 *
 * Two-phase:
 *   1. createProgram with virtual CompilerHost for type-checking.
 *      Session context (prior statements) is prepended so the checker
 *      sees all existing bindings.
 *   2. transpileModule for JS emission (simpler, no virtual host needed).
 */
import ts from 'typescript';

export interface TscDiagnostic {
  message: string;
  /** 0-indexed line within the *statement* (not the combined file). */
  line: number;
  column: number;
  code: number;
}

export interface InferredBinding {
  name: string;
  type: string;
}

export interface TscResult {
  ok: boolean;
  diagnostics: TscDiagnostic[];
  /** Transpiled JS ready for QuickJS execution. */
  js: string;
  /** Types inferred for top-level bindings introduced by this statement. */
  inferredBindings: InferredBinding[];
}

export interface TscRunnerOptions {
  /**
   * Accumulated session.ts text from prior statements.
   * Used so the checker knows existing bindings.
   */
  sessionContext?: string;
  /** Module names to generate ambient `declare module` stubs for. */
  availableModules?: string[];
}

const BASE_COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: 'react',
  skipLibCheck: true,
  noEmit: false,
  declaration: false,
  useDefineForClassFields: true,
};

export function runTsc(statement: string, opts: TscRunnerOptions = {}): TscResult {
  const sessionContext = opts.sessionContext ?? '';
  const contextLen = sessionContext.length;

  // Combined source: prior context + newline separator + new statement
  const sep = sessionContext ? '\n' : '';
  const combined = sessionContext + sep + statement;
  const stmtOffset = sessionContext ? contextLen + 1 : 0;

  const moduleStubs = buildModuleStubs(opts.availableModules ?? []);

  const files: Record<string, string> = {
    'session.ts': combined,
    ...(moduleStubs ? { 'stubs.d.ts': moduleStubs } : {}),
  };

  const host = createInMemoryHost(files, BASE_COMPILER_OPTIONS);
  const rootNames = moduleStubs
    ? ['session.ts', 'stubs.d.ts']
    : ['session.ts'];
  const program = ts.createProgram(rootNames, BASE_COMPILER_OPTIONS, host);
  const sf = program.getSourceFile('session.ts')!;
  const checker = program.getTypeChecker();

  // Collect diagnostics that fall within the new statement portion
  const contextLineCount = sessionContext ? sessionContext.split('\n').length : 0;
  const allDiags: ts.Diagnostic[] = [
    ...program.getSyntacticDiagnostics(sf),
    ...program.getSemanticDiagnostics(sf),
  ];

  const diagnostics: TscDiagnostic[] = allDiags
    .filter(
      (d) =>
        d.file?.fileName === 'session.ts' &&
        (d.start ?? 0) >= stmtOffset,
    )
    .map((d) => {
      const pos = d.file!.getLineAndCharacterOfPosition(d.start ?? stmtOffset);
      return {
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        line: pos.line - contextLineCount,
        column: pos.character,
        code: d.code,
      };
    });

  // Infer types for bindings declared in the statement range
  const inferredBindings = extractInferredBindings(sf, checker, stmtOffset);

  // Transpile just the statement to JS for QuickJS execution
  const transpiled = ts.transpileModule(statement, {
    compilerOptions: BASE_COMPILER_OPTIONS,
  });
  const js = transpiled.outputText;

  return { ok: diagnostics.length === 0, diagnostics, js, inferredBindings };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildModuleStubs(modules: string[]): string {
  return modules
    .map(
      (m) =>
        `declare module '${m}' {\n  const _any: any;\n  export default _any;\n  export = _any;\n}`,
    )
    .join('\n');
}

function createInMemoryHost(
  files: Record<string, string>,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const defaultHost = ts.createCompilerHost(options);

  return {
    ...defaultHost,
    getSourceFile(fileName, langVersion) {
      if (Object.prototype.hasOwnProperty.call(files, fileName)) {
        return ts.createSourceFile(fileName, files[fileName]!, langVersion);
      }
      return defaultHost.getSourceFile(fileName, langVersion);
    },
    fileExists(fileName) {
      return (
        Object.prototype.hasOwnProperty.call(files, fileName) ||
        defaultHost.fileExists(fileName)
      );
    },
    readFile(fileName) {
      return files[fileName] ?? defaultHost.readFile(fileName);
    },
    writeFile() {
      // no-op — we don't emit to disk
    },
  };
}

function extractInferredBindings(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  stmtOffset: number,
): InferredBinding[] {
  const result: InferredBinding[] = [];

  for (const stmt of sf.statements) {
    // Only statements that start at or after the new statement's offset
    if (stmt.pos < stmtOffset) continue;

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          try {
            const type = checker.getTypeAtLocation(decl.name);
            result.push({ name: decl.name.text, type: checker.typeToString(type) });
          } catch {
            // checker can throw on error-recovery nodes
          }
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      try {
        const type = checker.getTypeAtLocation(stmt.name);
        result.push({ name: stmt.name.text, type: checker.typeToString(type) });
      } catch {
        // ignore
      }
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      try {
        const type = checker.getTypeAtLocation(stmt.name);
        result.push({ name: stmt.name.text, type: checker.typeToString(type) });
      } catch {
        // ignore
      }
    }
  }

  return result;
}
