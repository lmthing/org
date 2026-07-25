import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Standing gate for definition-of-done item 3 of the Tamagui migration: no `style={{…}}` on a
 * Tamagui-backed target.
 *
 * A Tamagui primitive splits style props out of its props, so a static style belongs on a PROP —
 * it participates in the atomic stylesheet, dedupes, and survives the `$`-token/theme indirection.
 * An inline `style` bypasses all of that and always wins the cascade, which is how the migration
 * accumulated 130 of them.
 *
 * The allowlist below is NOT technical debt. There are exactly two reasons to be on it:
 *
 * 1. **Tamagui SILENTLY DROPS the property** — probed, and for `listStyleType`/`wordBreak` also
 *    pinned in `primitives/index.test.tsx` under "SILENTLY DROPS these". `style` is the only thing
 *    that works, so an entry leaving this list means the property started working.
 * 2. **The value is UNBOUNDED-dynamic** — cursor coordinates, a drag-resized width, a live
 *    percentage. Tamagui mints ONE atomic CSS rule per distinct value, so a prop here grows the
 *    stylesheet without limit. A bounded ternary (two values, e.g. `opacity={busy ? 0.5 : 1}`) is
 *    NOT this case and belongs on a prop.
 *
 * Reason 2 was learned the hard way: converting the context menu's `top`/`left` to props passed the
 * typecheck and the P0 baseline, and was caught only by that element's own test reading
 * `menu.style.left`.
 */
const ALLOWED = [
  // 1. dropped by Tamagui
  ['src/chat/components/render-descriptor.tsx', 'listStyleType'],
  ['src/chat/components/ConsentCard.tsx', 'wordBreak'],
  ['src/chat/app/replay.tsx', 'accentColor'],
  ['src/computer/logs-viewer.tsx', 'wordBreak'],
  ['src/studio/thing/thing-panel/ToolCallDisplay.tsx', 'wordBreak'],
  ['src/studio/thing/thing-panel/ThingMessages.tsx', 'wordBreak'],
  // 2. unbounded-dynamic values
  ['src/elements/overlays/context-menu/index.tsx', 'top'],
  ['src/chat/app/DevPanel.tsx', 'width'],
  ['src/computer/metrics-card.tsx', 'cpuPercent'],
  ['src/computer/metrics-card.tsx', 'memPercent'],
]

/** Targets whose style props Tamagui splits out — an inline style here is the thing we forbid. */
const TAMAGUI_TARGET =
  /<(Prim\.(Box|Text|Pressable|Row|Col|Link|Form|List|ListItem|Pre|PreLeaf|Table|Thead|Tbody|Tr|Th|Td|TextField|TextArea|Select|Option|Image)|Box|Text|Pressable|Row|Col|Stack|Card|CardBody|CardHeader|Panel|PanelHeader|PanelBody|Page|PageBody|Heading|Caption|Code|Label|Button|Badge|Input|Textarea|Select|Sidebar|SidebarItem|TabBar|Breadcrumb|ListItem)(?=[\s/>]|$)/g

function findViolations() {
  const files = execSync('grep -rl "style={{" src --include=*.tsx || true', {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)

  const out = []
  for (const file of files) {
    const lines = readFileSync(resolve(ROOT, file), 'utf8').split('\n')
    lines.forEach((line, i) => {
      let at = line.indexOf('style={{')
      while (at !== -1) {
        // The nearest opening tag at or above this line decides whether the target is Tamagui-backed.
        let tag = null
        for (let j = i; j >= 0 && j > i - 40; j--) {
          const seg = j === i ? lines[j].slice(0, at) : lines[j]
          const m = [...seg.matchAll(TAMAGUI_TARGET)]
          if (m.length) { tag = m[m.length - 1][1]; break }
          if (/<[a-zA-Z][A-Za-z0-9_.]*(?=[\s/>]|$)/.test(seg)) break // a non-Tamagui tag is nearer
        }
        if (tag) out.push({ file, line: i + 1, tag, text: line.trim() })
        at = line.indexOf('style={{', at + 1)
      }
    })
  }
  return out
}

describe('no inline style on a Tamagui-backed target (migration item 3)', () => {
  const violations = findViolations()

  it('every remaining inline style is a property Tamagui DROPS', () => {
    const unexpected = violations.filter(
      (v) => !ALLOWED.some(([file, prop]) => v.file === file && v.text.includes(prop)),
    )
    expect(
      unexpected.map((v) => `${v.file}:${v.line} <${v.tag}> ${v.text.slice(0, 90)}`),
      'Put static styles on PROPS. If Tamagui genuinely drops the property, probe it (render and '
        + 'read the emitted atomic class), then add it to ALLOWED with the property named.',
    ).toEqual([])
  })

  it('the allowlist has no stale entries', () => {
    const unmatched = ALLOWED.filter(
      ([file, prop]) => !violations.some((v) => v.file === file && v.text.includes(prop)),
    )
    expect(
      unmatched.map(([f, p]) => `${f} (${p})`),
      'This call site no longer has an inline style — drop its ALLOWED entry.',
    ).toEqual([])
  })
})
