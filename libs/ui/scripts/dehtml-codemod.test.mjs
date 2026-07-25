import { describe, it, expect } from 'vitest'
import { transform } from './dehtml-codemod.mjs'

/**
 * The de-HTML codemod's correctness gate. It rewrites host tags across whole surfaces at a time,
 * so the cases that matter are the ones a human would never notice in a 100-tag diff.
 * See docs/react-native-tamagui-migration.md §7/§8.
 */

const run = (src, file = 'libs/ui/src/chat/x.tsx') => transform(file, src)

describe('tag rewriting', () => {
  it('rewrites open + close tags and injects the `as` / boolean attribute', () => {
    const { text } = run('export const A = () => <section><ol><li>x</li></ol></section>')
    expect(text).toContain('<Prim.Box as="section">')
    expect(text).toContain('</Prim.Box>')
    expect(text).toContain('<Prim.List ordered>')
    expect(text).toContain('<Prim.ListItem>')
  })

  it('leaves host tags inside strings, comments and already-migrated files alone', () => {
    const src = 'export const A = () => <Prim.Box>{"<div>not jsx</div>"}</Prim.Box>\n'
    expect(run(src).changed).toBe(false)
  })
})

describe('the namespace import', () => {
  it('uses a RELATIVE specifier inside libs/ui', () => {
    const { text } = run('export const A = () => <div />', 'libs/ui/src/chat/app/x.tsx')
    expect(text).toMatch(/^import \* as Prim from '\.\.\/\.\.\/elements\/primitives\/index\.js';/)
  })

  it('uses the PACKAGE specifier outside libs/ui — a relative path would leave the package', () => {
    const { text } = run('export const A = () => <div />', 'apps/web/src/routes/x.tsx')
    expect(text).toMatch(/^import \* as Prim from '@lmthing\/ui\/elements\/primitives';/)
  })

  it('REGRESSION: does not add a second import when the file already imports the namespace', () => {
    // Keyed on the BINDING name, not the path: `pin-gate` imported Prim via the package specifier
    // and got a relative one inserted beside it. `tsc --noCheck` (libs/ui's only gate) does not
    // see duplicate identifiers, so it reached the Tamagui babel extractor and broke the build.
    for (const existing of [
      "import * as Prim from '@lmthing/ui/elements/primitives'",
      "import * as Prim from '../../elements/primitives/index.js'",
    ]) {
      const { text } = run(`${existing}\nexport const A = () => <div><Prim.Text>x</Prim.Text></div>\n`)
      expect(text.match(/import \* as Prim/g)).toHaveLength(1)
      expect(text).toContain('<Prim.Box>')
    }
  })
})
