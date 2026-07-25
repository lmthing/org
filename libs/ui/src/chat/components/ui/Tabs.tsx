import * as Prim from '../../../elements/primitives/index';
import React from 'react';

interface TabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * `.border-primary text-foreground` / `.border-transparent text-muted-foreground hover:text-foreground`
 * as prop bags. `border-*` in Tailwind sets all four border colours, so `borderColor` (not
 * `borderBottomColor`) is the faithful translation — only the bottom edge has width, but P0 audits
 * all four colours.
 */
const TAB_ACTIVE = { borderColor: '$primary', color: '$foreground' } as const;
const TAB_IDLE = {
  borderColor: 'transparent',
  color: '$muted-foreground',
  hoverStyle: { color: '$foreground' },
} as const;

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <Prim.Box display="flex" className={className} borderBottomWidth={1} borderColor="$border" role="tablist">
      {tabs.map(t => (
        <Prim.Pressable
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          {...(t.id === active ? TAB_ACTIVE : TAB_IDLE)} transition="quick" animateOnly={["color", "background-color", "border-color"]} paddingHorizontal="$3" paddingVertical="$2" fontSize="$xs" fontWeight="$medium" borderBottomWidth={2} marginBottom="-$px"
        >
          {t.label}
        </Prim.Pressable>
      ))}
    </Prim.Box>
  );
}
