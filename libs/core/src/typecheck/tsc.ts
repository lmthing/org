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
  /** Ambient declarations (library-dts + overlay concatenated) */
  ambientDts: string;
  /** Previously accumulated successful session source */
  sessionContext: string;
  /** The new statement to check */
  statement: string;
}

const AMBIENT_FILE = '__ambient__.d.ts';
const SESSION_FILE = '__session__.tsx'; // .tsx so JSX syntax is allowed

/**
 * Absent-by-design GENERIC-FS/SHELL globals → the correct typed surface, named per global.
 *
 * There is NO generic filesystem on the model surface (see sdk/org/CLAUDE.md and
 * typecheck/library-dts.ts): `readFile`/`writeFile`/`editFile`/`listDir`/`glob`/`grep`/raw
 * `execShell`/`readFileRaw`/`writeFileRaw` are deliberately absent from every agent's DTS (the ONE
 * exception is the engineer's scratch root, `fs:scratch`). Persistence goes ONLY through the typed
 * root-scoped writers (`writeProject*`); reads through `readProjectFile`/`listProjectDir` (project)
 * or `readSpaceFile`/`listSpaceDir` (space).
 *
 * `Cannot find name 'X'` names what is MISSING but not what to reach for instead, so the model reads
 * the absence and flails (it even reaches through `(globalThis as any).readFileRaw` to dodge the
 * gate). Decorate the diagnostic with the concrete replacement so a retry lands the correct call in
 * ONE step instead of guessing. The message carries the repair at the point the typecheck produces
 * it, so every consumer (the turn-loop's error block, `typecheckSource`, …) sees it.
 */
const ABSENT_GLOBAL_REPLACEMENT: Record<string, string> = {
  readFile:
    'there is no generic fs — read with `readProjectFile(path)` (project) or `readSpaceFile(path)` (space)',
  readFileRaw:
    '`readFileRaw` is an internal host primitive, NOT available to you — read with `readProjectFile(path)` (project) or `readSpaceFile(path)` (space)',
  writeFile:
    'there is no generic fs — persist ONLY through a typed `writeProject*` writer (writeProjectTable / writeProjectEntity / writeProjectQuery / writeProjectApi / writeProjectHook / writeProjectEvent / writeProjectFunction / writeProjectView / writeProjectViewComponent / …)',
  writeFileRaw:
    '`writeFileRaw` is an internal host primitive, NOT available to you — persist through a typed `writeProject*` writer (e.g. `writeProjectApi(route, src)` to write an API handler)',
  editFile:
    'there is no generic fs — read with `readProjectFile(path)` (project) / `readSpaceFile(path)` (space) and re-write through a `writeProject*` writer',
  listDir:
    'use `listProjectDir(dir)` (project) or `listSpaceDir(dir)` (space); there is no generic fs',
  glob:
    'use `listProjectDir(dir)` (project) / `listSpaceDir(dir)` (space) — list, don\'t glob; there is no generic fs',
  grep:
    'read with `readProjectFile(path)` (project) / `readSpaceFile(path)` (space) and scan the content (or `localSearch` inside a granted desktop folder); there is no generic fs',
  execShell:
    '`execShell` is not on the model surface — only the engineer has a scratch sandbox (its `execShell`, after `createScratch()`); otherwise delegate the code to the engineer and persist what it returns with a typed `writeProject*` writer',
};

/**
 * Append the correct alternative to a `Cannot find name '<absentGlobal>'` diagnostic, so the message
 * names the repair rather than just the absence. Returns the message unchanged when it does not
 * match a known absent-by-design generic-fs/shell name.
 */
function decorateAbsentGlobal(message: string): string {
  const m = message.match(/Cannot find name '([^']+)'/);
  if (!m) return message;
  const replacement = ABSENT_GLOBAL_REPLACEMENT[m[1] as keyof typeof ABSENT_GLOBAL_REPLACEMENT];
  if (!replacement) return message;
  // Drop any trailing TypeScript suggestion ("Did you mean …?") and append the known repair.
  const base = message.split(". Did you mean")[0]!.replace(/\.$/, '');
  return `${base}. HINT: ${replacement}.`;
}

export function runTsc(opts: TscOpts): TscResult {
  const { ambientDts, statement } = opts;

  // A statement is free to REBIND a name the context already bound: at runtime it is its own
  // module, so its `const x = …` shadows the carried-over `globalThis.x`. Replaying the context
  // as one concatenated scope would instead call that a redeclaration — and then refuse the
  // reassignment too, leaving the model no legal move and burning every retry on a statement the
  // runtime would have accepted. Shadow the prior declaration, exactly as the runtime does.
  const { context: sessionContext, shadowedDts } = shadowRedeclared(opts.sessionContext, statement);

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
    [AMBIENT_FILE, shadowedDts ? `${ambientDts}\n${shadowedDts}` : ambientDts],
    [SESSION_FILE, combined],
  ]);

  const compilerOptions: ts.CompilerOptions = {
    // Keep strict null/property/index checking, but accept callbacks whose source collection is
    // dynamically typed (`any`) at the statement boundary. Agent results commonly arrive as
    // `any`; rejecting `.map((x) => …)` / `.filter((x) => …)` there burns a retry without
    // making the runtime safer. A concrete `string[]` still contextually types its callback.
    strict: true,
    noImplicitAny: false,
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
    // NEVER auto-include node_modules/@types/*. Without this, any dev checkout
    // with @types/node installed silently re-declares fetch/setTimeout/Buffer/
    // require on the model surface — voiding the deliberate DTS absences that
    // gate those calls (the whole "not granted ⇒ absent from the DTS" model)
    // and making the gate behave differently on a pod vs. a dev tree.
    types: [],
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

    const message = decorateAbsentGlobal(
      ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
    );
    diagnostics.push({
      line: line - statementStartLine,
      col: character,
      code: diag.code,
      message,
    });
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

/** Every name a top-level declaration binds (`const x`, `const {a, b: c}`, `function f`, …). */
function declaredNames(node: ts.Node): string[] {
  const names: string[] = [];
  const walkBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else for (const el of name.elements) if (ts.isBindingElement(el)) walkBinding(el.name);
  };
  if (ts.isVariableStatement(node)) {
    for (const d of node.declarationList.declarations) walkBinding(d.name);
  } else if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    names.push(node.name.text);
  }
  return names;
}

/**
 * Blank out any top-level declaration in `context` whose name `statement` re-declares, so the new
 * declaration stands alone — the same shadowing the runtime gives it for free by evaluating each
 * statement as its own module.
 *
 * Blanking preserves the newline count (diagnostic line numbers are computed off the context's line
 * count, so the ranges must not move). A blanked declaration may also have bound names the new
 * statement does NOT redeclare (`const {a, b} = …` where only `a` comes back); those would go from
 * typed to unresolvable, so they are re-declared ambiently as `any` — resolvable, like any other
 * carried-over binding whose precise type we cannot replay.
 */
function shadowRedeclared(context: string, statement: string): { context: string; shadowedDts: string } {
  if (!context) return { context, shadowedDts: '' };
  const stmtFile = ts.createSourceFile('__stmt__.tsx', statement, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const rebound = new Set(stmtFile.statements.flatMap((s) => declaredNames(s)));
  if (rebound.size === 0) return { context, shadowedDts: '' };

  const ctxFile = ts.createSourceFile('__ctx__.tsx', context, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const cuts: Array<{ start: number; end: number }> = [];
  const orphaned = new Set<string>();
  for (const s of ctxFile.statements) {
    const names = declaredNames(s);
    if (!names.some((n) => rebound.has(n))) continue;
    cuts.push({ start: s.getStart(ctxFile), end: s.getEnd() });
    for (const n of names) if (!rebound.has(n)) orphaned.add(n);
  }
  if (cuts.length === 0) return { context, shadowedDts: '' };

  let out = '';
  let cursor = 0;
  for (const { start, end } of cuts) {
    const cut = context.slice(start, end);
    out += context.slice(cursor, start) + '\n'.repeat((cut.match(/\n/g) ?? []).length);
    cursor = end;
  }
  out += context.slice(cursor);
  const shadowedDts = [...orphaned].map((n) => `declare const ${n}: any;`).join('\n');
  return { context: out, shadowedDts };
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
