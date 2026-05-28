import ts from 'typescript';

export interface TscDiagnostic {
  line: number;
  col: number;
  code: number;
  message: string;
}

export interface TscResult {
  ok: boolean;
  diagnostics: TscDiagnostic[];
}

export interface TscOpts {
  /** Ambient declarations (library-dts + overlay-dts concatenated) */
  ambientDts: string;
  /** Previously accumulated successful session source */
  sessionContext: string;
  /** The new statement to check */
  statement: string;
}

const AMBIENT_FILE = '__ambient__.d.ts';
const SESSION_FILE = '__session__.tsx'; // .tsx so JSX syntax is allowed

export function runTsc(opts: TscOpts): TscResult {
  const { ambientDts, sessionContext, statement } = opts;

  // MODULE_HEADER makes the file a module so top-level await is allowed
  const MODULE_HEADER = 'export {};\n';
  const headerLines = MODULE_HEADER.split('\n').length - 1; // 1 line

  // Build the combined source: header + context + new statement
  const contextLineCount = sessionContext ? sessionContext.split('\n').length : 0;
  const combined = sessionContext
    ? `${MODULE_HEADER}${sessionContext}\n${statement}`
    : `${MODULE_HEADER}${statement}`;

  const statementStartLine = headerLines + contextLineCount;

  const fileMap = new Map<string, string>([
    [AMBIENT_FILE, ambientDts],
    [SESSION_FILE, combined],
  ]);

  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    // Classic JSX: <Foo x="y" /> → React.createElement(Foo, { x: "y" })
    // React is declared globally in library-dts so no import needed
    jsx: ts.JsxEmit.React,
    jsxFactory: 'React.createElement',
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts'],
  };

  const host = createInMemoryHost(fileMap, compilerOptions);
  const program = ts.createProgram(
    [AMBIENT_FILE, SESSION_FILE],
    compilerOptions,
    host,
  );

  // statementStartLine is computed above

  const allDiagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];

  const diagnostics: TscDiagnostic[] = [];
  for (const diag of allDiagnostics) {
    if (!diag.file) continue;
    if (diag.file.fileName !== SESSION_FILE) continue;

    const { line, character } = diag.file.getLineAndCharacterOfPosition(
      diag.start ?? 0,
    );

    // Filter to only diagnostics in the statement's line range
    if (line < statementStartLine) continue;

    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    diagnostics.push({
      line: line - statementStartLine,
      col: character,
      code: diag.code,
      message,
    });
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

function createInMemoryHost(
  files: Map<string, string>,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const defaultHost = ts.createCompilerHost(options);

  return {
    ...defaultHost,
    getSourceFile(fileName, languageVersion) {
      const content = files.get(fileName);
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      // Fall back to default for lib files
      return defaultHost.getSourceFile(fileName, languageVersion);
    },
    fileExists(fileName) {
      return files.has(fileName) || defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      return files.get(fileName) ?? defaultHost.readFile(fileName);
    },
    writeFile() {
      // no-op: noEmit
    },
    getDefaultLibFileName: defaultHost.getDefaultLibFileName.bind(defaultHost),
    getCurrentDirectory: defaultHost.getCurrentDirectory.bind(defaultHost),
    getCanonicalFileName: defaultHost.getCanonicalFileName.bind(defaultHost),
    useCaseSensitiveFileNames: defaultHost.useCaseSensitiveFileNames.bind(defaultHost),
    getNewLine: defaultHost.getNewLine.bind(defaultHost),
  };
}
