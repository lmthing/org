import { describe, it, expect } from 'vitest'
import { convertStylesheet, declToProps, bagName, serializeBag, trimStylesheet } from './bem-to-props.mjs'

/**
 * Gate for the BEM-stylesheet → prop-bag codemod (docs/tamagui-idiomatic-migration.md §4).
 * The load-bearing property is the SAFETY RULE: a rule converts only if every declaration in it
 * maps, so nothing is ever silently half-converted.
 */
describe('declToProps', () => {
  it('expands the padding/margin shorthands', () => {
    expect(declToProps('padding', '1rem')).toEqual({ paddingVertical: '1rem', paddingHorizontal: '1rem' })
    expect(declToProps('padding', '0.6rem 0.85rem')).toEqual({ paddingVertical: '0.6rem', paddingHorizontal: '0.85rem' })
    expect(declToProps('margin', '1px 2px 3px 4px')).toEqual({
      marginTop: '1px', marginRight: '2px', marginBottom: '3px', marginLeft: '4px',
    })
  })

  it('expands border shorthands per side', () => {
    expect(declToProps('border', '1px solid var(--border)')).toEqual({
      borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)',
    })
    expect(declToProps('border-bottom', '2px solid var(--border)')).toEqual({
      borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
    })
    expect(declToProps('border', 'none')).toEqual({ borderWidth: 0 })
  })

  it('maps `flex: 1` to the three flex props', () => {
    expect(declToProps('flex', '1')).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '0%' })
  })

  it('camel-cases the plain cases and normalises background', () => {
    expect(declToProps('font-size', '0.75rem')).toEqual({ fontSize: '0.75rem' })
    expect(declToProps('background', 'var(--color-primary)')).toEqual({ backgroundColor: 'var(--color-primary)' })
  })

  it('refuses what has no prop form', () => {
    expect(declToProps('transition', 'all 0.2s')).toBeNull()
    expect(declToProps('background', 'linear-gradient(to right, red, blue)')).toBeNull()
    expect(declToProps('box-shadow', '0 1px 2px rgba(0,0,0,.1)')).toBeNull()
    expect(declToProps('grid-template-columns', '1fr 1fr')).toBeNull()
  })
})

describe('convertStylesheet', () => {
  it('converts @apply through the shared className map and merges plain declarations', () => {
    const { converted, blocked } = convertStylesheet(`
      .thing { @apply flex! items-center; gap: 0.5rem; }
    `)
    expect(blocked).toEqual([])
    expect(converted).toHaveLength(1)
    expect(converted[0].props).toEqual({ display: 'flex', alignItems: 'center', gap: '0.5rem' })
  })

  it('REGRESSION: a leading `@reference` must not swallow the first rule', () => {
    // The statement at-rule has no block, so a naive selector capture glues it onto the first
    // selector, which then looks like an at-rule and is skipped — silently dropping one rule per
    // stylesheet (14 across the 16 real ones).
    const { converted } = convertStylesheet(`@reference "../../theme.css";

      .first { color: red; }
      .second { color: blue; }
    `)
    expect(converted.map((c) => c.selector)).toEqual(['.first', '.second'])
  })

  it('blocks a rule when ANY declaration is unmappable, rather than half-converting it', () => {
    const { converted, blocked } = convertStylesheet(`
      .x { color: red; transition: all 0.2s; }
    `)
    expect(converted).toEqual([])
    expect(blocked).toHaveLength(1)
    expect(blocked[0].reason).toContain('transition')
  })

  it('blocks structural selectors (descendant, pseudo-element, state)', () => {
    const { converted, blocked } = convertStylesheet(`
      .a .b { color: red; }
      .c::before { color: red; }
      .d:hover { color: red; }
    `)
    expect(converted).toEqual([])
    expect(blocked).toHaveLength(3)
  })

  it('blocks an @apply utility the className map keeps or skips', () => {
    const { blocked } = convertStylesheet(`.y { @apply transition-colors; }`)
    expect(blocked).toHaveLength(1)
  })
})

describe('bagName', () => {
  it('derives a constant name from the BEM selector', () => {
    expect(bagName('.app-sidebar__dropdown-item--active')).toBe('APP_SIDEBAR_DROPDOWN_ITEM_ACTIVE')
    expect(bagName('.card')).toBe('CARD')
  })
})

/**
 * The call-site rewriter's import placement. Extracted here because getting it wrong produced a
 * syntax error in a real file during the knowledge sweep.
 */
describe('bem-rewrite-callsites import placement', () => {
  /** Mirror of the insertion rule in bem-rewrite-callsites.mjs. */
  const insertImport = (src, stmt) => {
    const importStmt = /^import\s+(?:[^'"]*?from\s*)?['"][^'"]+['"];?[ \t]*$/gm
    let end = 0
    for (const m of src.matchAll(importStmt)) end = m.index + m[0].length
    return end ? `${src.slice(0, end)}\n${stmt}${src.slice(end)}` : `${stmt}\n${src}`
  }

  it('REGRESSION: inserts after a MULTI-LINE import, not inside it', () => {
    // Matching "lines that start with `import`" puts the new statement between `import {` and its
    // members, which does not parse.
    const src = "import { Button } from './b'\nimport {\n  Bold,\n  Italic,\n} from 'lucide-react'\n\nexport const x = 1\n"
    const out = insertImport(src, "import { A } from './props.js'")
    expect(out).toContain("} from 'lucide-react'\nimport { A } from './props.js'")
    expect(out).not.toContain("import {\nimport { A }")
  })

  it('inserts after the last single-line import', () => {
    const out = insertImport("import a from 'a'\nimport b from 'b'\n\nconst x = 1\n", "import { A } from './p.js'")
    expect(out).toContain("import b from 'b'\nimport { A } from './p.js'")
  })

  it('prepends when the file has no imports', () => {
    expect(insertImport('const x = 1\n', "import { A } from './p.js'")).toMatch(/^import \{ A \}/)
  })
})

describe('serializeBag', () => {
  it('annotates raw colour literals so generated files pass lint:tokens', () => {
    // `@apply text-white` is allowed inside CSS but becomes a raw hex once it is a value in a
    // `.ts` file. Generated output must carry the escape itself — hand-adding it would be lost.
    const out = serializeBag({ width: '$3', color: '#fff' })
    expect(out).toMatch(/"color": "#fff" \/\/ ds-lint-ok:/)
    expect(out).not.toMatch(/"width": "\$3" \/\//)
  })

  it('annotates rgba() literals too', () => {
    expect(serializeBag({ color: 'rgba(0,0,0,0.5)' })).toMatch(/ds-lint-ok:/)
  })
})

describe('trimStylesheet', () => {
  it('keeps only the named rules, preserving their source', () => {
    const css = `@reference "../t.css";\n\n.a { color: red; }\n\n.b { color: blue; }\n`
    const out = trimStylesheet(css, ['.b'])
    expect(out).toContain('.b {')
    expect(out).not.toContain('.a {')
    expect(out).toContain('@reference')
  })

  it('returns empty when nothing is kept, so the caller can delete the file', () => {
    expect(trimStylesheet('.a { color: red; }', [])).toBe('')
  })
})
