import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

interface TabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <Prim.Box display="flex" className={cn('border-b border-border', className)} role="tablist">
      {tabs.map(t => (
        <Prim.Pressable
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
            t.id === active
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Prim.Pressable>
      ))}
    </Prim.Box>
  );
}
