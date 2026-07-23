import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  className?: string;
  side?: 'top' | 'bottom';
}

export function Tooltip({ children, content, className, side = 'top' }: TooltipProps) {
  return (
    <Prim.Text className={cn('relative group inline-flex', className)}>
      {children}
      <Prim.Text
        className={cn(
          'pointer-events-none absolute z-50 px-2 py-1 text-xs rounded-md bg-foreground text-background whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 -translate-x-1/2 left-1/2',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </Prim.Text>
    </Prim.Text>
  );
}
