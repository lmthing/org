#!/usr/bin/env node
/**
 * lint-self-imports.mjs — forbid `@lmthing/ui/…` imports INSIDE `libs/ui/src`.
 *
 * A package importing itself by its own name is resolved by whatever the consuming bundler happens
 * to do with the `exports` map, and the map here is a wildcard onto a DIRECTORY:
 *
 *   "./elements/*": "./src/elements/*"        →  @lmthing/ui/elements/typography/caption
 *                                                 resolves to  src/elements/typography/caption
 *                                                 which is a directory, not a file.
 *
 * Vite and tsc do directory-index resolution there (and `hooks/*` is not even IN the exports map —
 * it only ever worked through the tsconfig `paths` alias). **Metro does not**, so every one of
 * these was unresolvable on the React Native target while being invisible on web. 288 of them
 * across 64 files were the wall the native graph hit first (docs/mobile-native-chat.md).
 *
 * A relative import needs no exports map, no alias and no bundler agreement, so it is the form that
 * works on every target. This gate keeps them from coming back.
 *
 * AST-based, like `lint-rn-safety.mjs`: only real module specifiers count. The string
 * `'@lmthing/ui'` also appears inside the component-editor's TEMPLATES and a placeholder — code
 * this package generates for a USER to author against, where the package name is exactly right.
 * A regex flags all three.
 *
 * Usage: node libs/ui/scripts/lint-self-imports.mjs [dir …]   (defaults to libs/ui/src)
 */
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const isSelfImport = (s) => s === '@lmthing/ui' || s.startsWith('@lmthing/ui/')

/** Every module specifier in `source`, as `{ specifier, line }`. */
function moduleSpecifiers(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const record = (node) => {
    if (node && ts.isStringLiteral(node)) {
      found.push({
        specifier: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      })
    }
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) record(node.moduleSpecifier)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) record(node.argument.literal)
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const dirs = process.argv.slice(2)
const files = dirs.length ? dirs.flatMap((d) => walk(d)) : walk(uiSrc)
const failures = []

for (const file of files) {
  for (const { specifier, line } of moduleSpecifiers(readFileSync(file, 'utf8'), file)) {
    if (isSelfImport(specifier)) failures.push({ file: relative(uiSrc, file), line, specifier })
  }
}

if (failures.length) {
  console.error(`\n${failures.length} self-referencing import(s) inside libs/ui/src:\n`)
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  ${f.specifier}`)
  }
  console.error(
    '\nUse a RELATIVE path instead. `@lmthing/ui/x` resolves through an exports wildcard that lands\n' +
      'on a directory; Metro does no directory-index resolution there, so the native target cannot\n' +
      'resolve it at all. See libs/ui/scripts/lint-self-imports.mjs for the full reason.\n',
  )
  process.exit(1)
}

console.log(`lint-self-imports: clean (${files.length} files)`)
