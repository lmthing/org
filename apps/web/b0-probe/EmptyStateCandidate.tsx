import React from 'react'
import { Text, Pressable } from '@lmthing/ui/elements/primitives/index'
import { Row, Col } from './surface-config'

/**
 * MIGRATED EmptyState (candidate) — the B2 layout migration applied to a real chat surface component.
 *
 * Mirrors libs/ui/src/chat/app/EmptyState.tsx EXACTLY except the three flex `Box` containers become
 * Tamagui `Row`/`Col` with the verified class-vs-prop split (docs Part III / "B2 — codemod rules"):
 *   - flex flex-col items-center justify-center flex-1 …  →  <Col> alignItems=center + flex props;
 *     justify-center / paint / spacing kept as className
 *   - flex items-center justify-center …                  →  <Row> alignItems=center; rest kept
 *   - flex flex-wrap gap-2 justify-center …               →  <Row> flex-wrap/gap/justify kept
 * Text/Pressable stay the REAL passthrough primitives (unchanged) so this isolates the layout swap.
 * measure-surface.mjs asserts this renders computed-identical to the reference EmptyState.
 */
const SUGGESTIONS = ['Research a topic for me', 'Help me write code', 'Analyze data', 'Build a specialist agent']

interface EmptyStateProps {
  projectName?: string
  onSuggestion?: (text: string) => void
  className?: string
}

export function EmptyStateCandidate({ projectName, onSuggestion, className }: EmptyStateProps) {
  return (
    <Col
      className={['justify-center px-6 py-12 text-center', className].filter(Boolean).join(' ')}
      alignItems="center"
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
    >
      <Row
        className="w-12 h-12 rounded-xl bg-brand-2/20 justify-center mb-5 text-2xl"
        alignItems="center"
        // .is_View sets line-height from the config font (an undefined var → `normal` = 36px on a
        // bare View), overriding text-2xl's 2rem/32px. `lineHeight` is not a Tamagui View style prop
        // (dropped), so restore text-2xl's line-height via the pass-through `style` (inline wins).
        style={{ lineHeight: '2rem' }}
      >
        ✦
      </Row>
      <Text as="h1" className="font-display text-2xl font-bold text-foreground mb-2">
        How can I help{projectName ? ` in ${projectName}` : ''}?
      </Text>
      <Text as="p" className="text-muted-foreground text-sm max-w-xs mb-8">
        Ask me anything — I can research, code, analyze, or build specialist agents.
      </Text>
      {onSuggestion && (
        <Row className="flex-wrap gap-2 justify-center max-w-sm">
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onClick={() => onSuggestion(s)}
              className="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {s}
            </Pressable>
          ))}
        </Row>
      )}
    </Col>
  )
}
