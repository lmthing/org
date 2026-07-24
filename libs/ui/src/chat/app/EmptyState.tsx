import React from 'react';
import { cn } from '../lib/cn.js';
import { Row, Col, Text, Pressable } from '../../elements/primitives/index.js';

const SUGGESTIONS = [
  'Research a topic for me',
  'Help me write code',
  'Analyze data',
  'Build a specialist agent',
];

interface EmptyStateProps {
  projectName?: string;
  onSuggestion?: (text: string) => void;
  className?: string;
}

/**
 * Migrated to Tamagui Row/Col (Part III / B2). The three flex Boxes became Row/Col with the verified
 * class-vs-prop split: `items-` classes became the `alignItems` prop, `flex-1` became
 * `flexGrow/flexShrink/flexBasis` props; `justify-`, `gap-`, paint and spacing classes stayed as
 * className. The icon container carries `text-2xl`, so its line-height is restored via inline style
 * (the Tamagui View base overrides it). Proven computed-identical to the pre-migration render (9/9
 * nodes) in apps/web/b0-probe/measure-surface.mjs.
 */
export function EmptyState({ projectName, onSuggestion, className }: EmptyStateProps) {
  return (
    <Col
      className={cn('justify-center px-6 py-12 text-center', className)}
      alignItems="center"
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
    >
      <Row
        className="w-12 h-12 rounded-xl bg-brand-2/20 justify-center mb-5 text-2xl"
        alignItems="center"
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
  );
}
