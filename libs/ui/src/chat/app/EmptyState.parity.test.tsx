import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EmptyState } from './EmptyState'

/**
 * Phase-0 de-HTML parity proof (the plan's Appendix step 2 / H8 step 3).
 *
 * `chat/app/EmptyState` was de-HTML'd onto the vocabulary primitives (Box/Text/Pressable).
 * GOLDEN is the EXACT innerHTML the component produced on `main` BEFORE the migration
 * (captured once from the pre-migration implementation). This asserts the migrated component
 * renders byte-identical HTML — the strongest possible parity story: the DOM literally does
 * not change. This is the jsdom-level equivalent of the L2 (computed-style) + L3 (visual)
 * gates for one real component; the browser-based L2/L3 harness (§3) is still pending.
 *
 * If this ever fails, a wrapper changed the DOM/className — that is a bug to fix, NOT a golden
 * to update (the golden only moves via a deliberate, reviewed change to EmptyState itself).
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
const GOLDEN =
  '<div class="flex flex-col items-center justify-center flex-1 px-6 py-12 text-center extra">' +
  '<div class="w-12 h-12 rounded-xl bg-brand-2/20 flex items-center justify-center mb-5 text-2xl">✦</div>' +
  '<h1 class="font-display text-2xl font-bold text-foreground mb-2">How can I help in Acme?</h1>' +
  '<p class="text-muted-foreground text-sm max-w-xs mb-8">Ask me anything — I can research, code, analyze, or build specialist agents.</p>' +
  '<div class="flex flex-wrap gap-2 justify-center max-w-sm">' +
  '<button class="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">Research a topic for me</button>' +
  '<button class="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">Help me write code</button>' +
  '<button class="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">Analyze data</button>' +
  '<button class="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">Build a specialist agent</button>' +
  '</div></div>'

describe('EmptyState — de-HTML byte-identical parity', () => {
  it('renders byte-identical HTML to the pre-migration golden', () => {
    const { container } = render(
      <EmptyState projectName="Acme" onSuggestion={() => {}} className="extra" />,
    )
    expect(container.innerHTML).toBe(GOLDEN)
  })

  it('omits the suggestion row and project name when those props are absent', () => {
    const { container } = render(<EmptyState />)
    // No onSuggestion ⇒ no suggestion buttons rendered.
    expect(container.querySelectorAll('button')).toHaveLength(0)
    // Structure is preserved: a heading and a body paragraph.
    expect(container.querySelector('h1')?.textContent).toBe('How can I help?')
    expect(container.querySelector('p')).not.toBeNull()
  })
})
