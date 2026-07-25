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
    <Prim.Box display="flex" className={className} borderBottomWidth={1} borderColor="$border" role="tablist">
      {tabs.map(t => (
        <Prim.Pressable
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={t.id === active
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'} transition="quick" animateOnly={["color", "background-color", "border-color"]} paddingHorizontal="$3" paddingVertical="$2" fontSize="$xs" fontWeight="$medium" borderBottomWidth={2} marginBottom="-$px"
        >
          {t.label}
        </Prim.Pressable>
      ))}
    </Prim.Box>
  );
}
