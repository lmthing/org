import React from 'react';
import { cn } from '../lib/cn';
import { Row, Col, Text, Pressable } from '../../elements/primitives/index';

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
      className={className} justifyContent="center" paddingHorizontal="$6" paddingVertical="$12" textAlign="center"
      alignItems="center"
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
    >
      <Row
        backgroundColor="color-mix(in srgb, var(--brand-2) 20%, transparent)" width="$12" height="$12" borderRadius="$radius-xl" justifyContent="center" marginBottom="$5" fontSize="$2xl"
        alignItems="center"
        lineHeight="2rem"
      >
        ✦
      </Row>
      <Text as="h1" fontFamily="$heading" fontSize="$2xl" fontWeight="$bold" color="$foreground" marginBottom="$2">
        How can I help{projectName ? ` in ${projectName}` : ''}?
      </Text>
      <Text as="p" color="$muted-foreground" fontSize="$sm" maxWidth={320} marginBottom="$8">
        Ask me anything — I can research, code, analyze, or build specialist agents.
      </Text>
      {onSuggestion && (
        <Row flexWrap="wrap" gap="$2" justifyContent="center" maxWidth={384}>
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onClick={() => onSuggestion(s)}
              transition="quick" animateOnly={["color", "background-color", "border-color"]} paddingHorizontal="$3" paddingVertical="$1.5" borderRadius="$radius-full" borderWidth={1} borderColor="$border" fontSize="$sm" color="$muted-foreground" hoverStyle={{ color: "$foreground", borderColor: "color-mix(in srgb, var(--foreground) 30%, transparent)" }}
            >
              {s}
            </Pressable>
          ))}
        </Row>
      )}
    </Col>
  );
}
