/**
 * bem-rewrite-callsites — swap `className="block__el"` for the prop bag `bem-to-props` emitted.
 *
 * The second half of the components sweep (docs/tamagui-idiomatic-migration.md §4). Given a
 * stylesheet and the module its bags now live in, rewrite every static call site:
 *
 *   <Prim.Box className="login-screen__container">  →  <Prim.Box {...LOGIN_SCREEN_CONTAINER}>
 *   className="a b"  →  {...A} className="b"        (only the converted token is lifted)
 *
 * Only STATIC string classNames are touched, and only tokens whose rule actually converted — a
 * class still backed by CSS is left alone. Dynamic `cn(...)`/template classNames are REPORTED.
 *
 *   node libs/ui/scripts/bem-rewrite-callsites.mjs --css=<sheet.css> --module=<import specifier> \
 *        [--check] <file.tsx> …
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { convertStylesheet } from './bem-to-props.mjs'

// CLI — guarded so importing this module (e.g. from bem-sweep.mjs) does not execute it with the
// importer's argv, which made it try to read a directory as a stylesheet.
const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isEntry) {
const args = process.argv.slice(2)
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const check = args.includes('--check')
const files = args.filter((a) => !a.startsWith('--'))

const { converted } = convertStylesheet(readFileSync(opt('css'), 'utf8'))
/** class token → bag name, for the rules that actually converted. */
const BAG = new Map(converted.map((c) => [c.selector.slice(1), c.name]))
const MODULE = opt('module')

let totalRewrites = 0
const dynamic = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const used = new Set()
  let out = src.replace(/className="([^"]*)"/g, (whole, value) => {
    const tokens = value.split(/\s+/).filter(Boolean)
    const lift = tokens.filter((t) => BAG.has(t))
    if (!lift.length) return whole
    lift.forEach((t) => used.add(BAG.get(t)))
    const rest = tokens.filter((t) => !BAG.has(t))
    const spreads = lift.map((t) => `{...${BAG.get(t)}}`).join(' ')
    totalRewrites += lift.length
    return rest.length ? `${spreads} className="${rest.join(' ')}"` : spreads
  })

  // Report the dynamic shapes this cannot touch.
  for (const m of src.matchAll(/className=\{(?:cn\(|`)([^`)]*)/g)) {
    for (const t of m[1].split(/[\s'"`,]+/)) if (BAG.has(t)) dynamic.push(`${file}: ${t}`)
  }

  if (!used.size) continue
  if (!check) {
    const names = [...used].sort().join(', ')
    // Insert after the last COMPLETE import statement. Matching "lines starting with `import`"
    // lands inside a multi-line `import {\n  A,\n  B,\n} from '…'` and produces a syntax error.
    const importStmt = /^import\s+(?:[^'"]*?from\s*)?['"][^'"]+['"];?[ \t]*$/gm
    let end = 0
    for (const m of out.matchAll(importStmt)) end = m.index + m[0].length
    out = end
      ? `${out.slice(0, end)}\nimport { ${names} } from '${MODULE}'${out.slice(end)}`
      : `import { ${names} } from '${MODULE}'\n${out}`
    writeFileSync(file, out)
  }
  console.log(`${check ? 'would rewrite' : 'rewrote'} ${file} (${used.size} bag(s))`)
}

for (const d of [...new Set(dynamic)]) console.log(`  DYNAMIC (manual) ${d}`)
console.log(`\n[bem-rewrite-callsites] ${totalRewrites} className token(s) lifted across ${files.length} file(s)`)
}
