import React from 'react';
import { cn } from '../lib/cn.js';
import { Box, Text, Pressable } from '../../elements/primitives/index.js';

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

export function EmptyState({ projectName, onSuggestion, className }: EmptyStateProps) {
  return (
    <Box className={cn('flex flex-col items-center justify-center flex-1 px-6 py-12 text-center', className)}>
      <Box className="w-12 h-12 rounded-xl bg-brand-2/20 flex items-center justify-center mb-5 text-2xl">
        ✦
      </Box>
      <Text as="h1" className="font-display text-2xl font-bold text-foreground mb-2">
        How can I help{projectName ? ` in ${projectName}` : ''}?
      </Text>
      <Text as="p" className="text-muted-foreground text-sm max-w-xs mb-8">
        Ask me anything — I can research, code, analyze, or build specialist agents.
      </Text>
      {onSuggestion && (
        <Box className="flex flex-wrap gap-2 justify-center max-w-sm">
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onClick={() => onSuggestion(s)}
              className="px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {s}
            </Pressable>
          ))}
        </Box>
      )}
    </Box>
  );
}
