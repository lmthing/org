import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  className?: string;
  side?: 'top' | 'bottom';
}

export function Tooltip({ children, content, className, side = 'top' }: TooltipProps) {
  return (
    // Tamagui's `group` PROP (marker `t_group`), not Tailwind's `group` class — `$group-hover` on
    // the bubble below keys off the prop, and a class here would leave it dead.
    // See docs/tamagui-idiomatic-migration.md §5.
    <Prim.Text display="inline-flex" {...({ group: true } as Record<string, unknown>)} className={className} position="relative">
      {children}
      <Prim.Text
        display="block"
        whiteSpace="nowrap"
        {...(side === 'top' ? { marginBottom: '0.375rem' } : { marginTop: '0.375rem' })}
        {...(side === 'top' ? { bottom: '100%' } : { top: '100%' })} transition="quick" animateOnly={["opacity"]} pointerEvents="none" position="absolute" zIndex={50} paddingHorizontal="$2" paddingVertical="$1" fontSize="$xs" borderRadius="$radius-md" backgroundColor="$foreground" color="$background" opacity={0} transform="translateX(-50%)" left="50%" $group-hover={{ opacity: 1 }}
      >
        {content}
      </Prim.Text>
    </Prim.Text>
  );
}
