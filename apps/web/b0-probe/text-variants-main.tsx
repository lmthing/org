import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui.config'
// The REAL shipped Text primitive (not a copy) — so the probe verifies the actual code, incl. that
// the semantic host tag renders (a tag regression can't hide behind matching computed style).
import { Text as Cand } from '@lmthing/ui/elements/primitives/index'
import './surface.css'

/**
 * B3.1 comprehensive Text-swap probe.
 *
 * Renders the CANDIDATE Tamagui `styled(Text)` (mirroring the planned real `text/index.tsx`
 * implementation) next to the RAW tag it replaces, for every `as` variant AND every conflict class
 * that the `.is_Text` base rule fights (`display:inline`, `white-space:pre-wrap`,
 * `word-wrap:break-word`). Both render under the compiled theme.css + Tailwind preflight (so a raw
 * `<h1>`/`<p>` is already margin/size-reset, matching real surfaces). text-variants.mjs walks each
 * pair and asserts computed-style parity across the full audited property set.
 *
 * The candidate lifts the conflict classes to Tamagui props exactly as the codemod will (see cases
 * tagged `lift:`). Everything else stays className (typography, colors, spacing) — proven ≡ by the
 * base text-probe already.
 */

// [label, refElement, candElement]. ref = raw tag; cand = the real Text primitive with lifted props.
type Case = [string, React.ReactElement, React.ReactElement]
const T = 'The quick brown fox'
const cases: Case[] = [
  ['span', <span className="text-sm text-foreground">{T}</span>, <Cand className="text-sm text-foreground">{T}</Cand>],
  ['p-block', <p className="text-sm text-foreground">{T}</p>, <Cand as="p" className="text-sm text-foreground">{T}</Cand>],
  ['block-prop', <p className="text-base">{T}</p>, <Cand block className="text-base">{T}</Cand>],
  ['h1', <h1 className="text-2xl font-bold text-foreground">{T}</h1>, <Cand as="h1" className="text-2xl font-bold text-foreground">{T}</Cand>],
  ['h2', <h2 className="text-xl font-semibold">{T}</h2>, <Cand as="h2" className="text-xl font-semibold">{T}</Cand>],
  ['strong', <strong className="font-semibold text-foreground">{T}</strong>, <Cand as="strong" className="font-semibold text-foreground">{T}</Cand>],
  ['em', <em className="italic text-muted-foreground">{T}</em>, <Cand as="em" className="italic text-muted-foreground">{T}</Cand>],
  ['small', <small className="text-xs">{T}</small>, <Cand as="small" className="text-xs">{T}</Cand>],
  ['code', <code className="font-mono text-agent">{T}</code>, <Cand as="code" className="font-mono text-agent">{T}</Cand>],
  ['kbd', <kbd className="font-mono text-xs">{T}</kbd>, <Cand as="kbd" className="font-mono text-xs">{T}</Cand>],
  ['dt', <dt className="font-semibold">{T}</dt>, <Cand as="dt" className="font-semibold">{T}</Cand>],
  ['dd', <dd className="text-muted-foreground">{T}</dd>, <Cand as="dd" className="text-muted-foreground">{T}</Cand>],
  // label carries htmlFor
  ['label', <label htmlFor="x" className="text-sm font-medium">{T}</label>, <Cand as="label" htmlFor="x" className="text-sm font-medium">{T}</Cand>],
  // whitespace default: multiple spaces + newline must collapse like a plain span
  ['ws-default', <span className="text-sm">{'a    b\n    c'}</span>, <Cand className="text-sm">{'a    b\n    c'}</Cand>],
  // lift: block class => display prop
  ['lift-block', <span className="block text-sm">{T}</span>, <Cand display="block" className="text-sm">{T}</Cand>],
  ['lift-inline-block', <span className="inline-block text-sm">{T}</span>, <Cand display="inline-block" className="text-sm">{T}</Cand>],
  ['lift-hidden', <span className="hidden">{T}</span>, <Cand display="none">{T}</Cand>],
  // lift: break-words => overflow-wrap prop
  ['lift-break-words', <span className="break-words text-sm">{T}</span>, <Cand wordWrap="break-word" className="text-sm">{T}</Cand>],
  // KEEP break-all as className: it sets word-break, which .is_Text does NOT touch (no conflict).
  ['keep-break-all', <code className="break-all font-mono">{T}</code>, <Cand as="code" className="break-all font-mono">{T}</Cand>],
  // MARGIN: .is_Text sets `margin:0` UNLAYERED and zeroes Tailwind mb-/mt-/ml- utilities → lift margin
  // classes to Tamagui props (rem strings matching the Tailwind scale). Verifies the B3.1/B3.2 fix:
  ['margin-p', <p className="mb-2 mt-3">{T}</p>, <Cand as="p" marginBottom="0.5rem" marginTop="0.75rem">{T}</Cand>],
  ['margin-span', <span className="ml-2 mr-1.5">{T}</span>, <Cand marginLeft="0.5rem" marginRight="0.375rem">{T}</Cand>],
  ['margin-auto', <span className="ml-auto">{T}</span>, <Cand marginLeft="auto">{T}</Cand>],
  // lift: truncate => overflow/textOverflow/whiteSpace props (+ keep max-w class)
  [
    'lift-truncate',
    <span className="truncate max-w-[120px] text-sm">{'a very long string that overflows'}</span>,
    <Cand overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" className="max-w-[120px] text-sm">{'a very long string that overflows'}</Cand>,
  ],
]

// Inheritance check: a Text with default whitespace inside a pre-wrap container must inherit pre-wrap
// (like a plain span would), so whitespace is preserved.
function App() {
  return (
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <div style={{ padding: 24 }}>
        {cases.map(([label, ref, cand]) => (
          <div key={label} data-case={label} style={{ display: 'flex', gap: 40 }}>
            <div data-role="ref">{ref}</div>
            <div data-role="cand">{cand}</div>
          </div>
        ))}
        {/* inheritance: whitespace-pre-wrap parent, default-whitespace child */}
        <div data-case="ws-inherit" style={{ display: 'flex', gap: 40 }}>
          <div data-role="ref" className="whitespace-pre-wrap">
            <span>{'x    y'}</span>
          </div>
          <div data-role="cand" className="whitespace-pre-wrap">
            <Cand>{'x    y'}</Cand>
          </div>
        </div>
      </div>
    </TamaguiProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__variantsReady = true
