import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui.config'
// The REAL shipped Pressable primitive — verifies the actual code (tag name + computed style).
import { Pressable as Cand } from '@lmthing/ui/elements/primitives/index'
import './surface.css'

/**
 * B3.2 Pressable-swap probe. Renders the REAL `Prim.Pressable` next to the raw tag it replaces, for
 * every `as` variant (button/a/div) AND the display-conflict scenarios (a bare button, an inline-flex
 * button = chat `<Button>`, an icon `flex` button, an inline-flex anchor), both under the compiled
 * theme.css + Tailwind PREFLIGHT (so a raw `<button>` is already border/appearance/font-reset, exactly
 * like the real surfaces). pressable-variants.mjs asserts tag NAME + computed-style parity.
 */
type Case = [string, React.ReactElement, React.ReactElement]
const cases: Case[] = [
  // bare button — the UA/preflight default box model must match (display inline-block, reset, etc.)
  ['bare-button', <button className="text-sm">Go</button>, <Cand className="text-sm">Go</Cand>],
  // chat <Button>: inline-flex row with a text-size class (the line-height collision case)
  [
    'inline-flex-button',
    <button className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg">Go</button>,
    <Cand display="inline-flex" className="items-center justify-center gap-1.5 h-8 px-3 text-sm font-medium rounded-lg">Go</Cand>,
  ],
  // icon button: flex (block-level) container
  [
    'flex-icon-button',
    <button className="h-8 w-8 rounded-lg flex items-center justify-center text-xs">i</button>,
    <Cand display="flex" className="h-8 w-8 rounded-lg items-center justify-center text-xs">i</Cand>,
  ],
  // disabled button
  ['disabled-button', <button disabled className="text-sm px-3">x</button>, <Cand disabled className="text-sm px-3">x</Cand>],
  // anchor (inline link)
  ['anchor', <a href="#x" className="text-sm underline text-brand-2">l</a>, <Cand as="a" href="#x" className="text-sm underline text-brand-2">l</Cand>],
  // anchor styled as a button (inline-flex)
  [
    'inline-flex-anchor',
    <a href="#x" className="inline-flex items-center gap-2 px-3 h-8 text-sm">l</a>,
    <Cand as="a" href="#x" display="inline-flex" className="items-center gap-2 px-3 h-8 text-sm">l</Cand>,
  ],
  // clickable div (block by default)
  ['div-button', <div role="button" className="cursor-pointer text-sm px-2">d</div>, <Cand as="div" role="button" className="cursor-pointer text-sm px-2">d</Cand>],
  // Variant-display cases that CAN'T be a static prop (group-hover/responsive). The fix is Tailwind's
  // `!` important modifier — `!important` beats BOTH Tamagui's unlayered `.is_Text` base AND the
  // primitive's `:root`-boosted default display (both normal declarations). Here we verify a plain
  // `hidden` (ref) ≡ `!hidden` (cand, which must beat the button's default inline-block).
  ['important-hidden', <button className="hidden">h</button>, <Cand className="!hidden">h</Cand>],
  ['important-flex', <button className="flex">f</button>, <Cand className="!flex">f</Cand>],
]

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
      </div>
    </TamaguiProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
;(window as any).__pressableReady = true
