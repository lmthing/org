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
    <Prim.Text display="inline-flex" className={cn('relative group', className)}>
      {children}
      <Prim.Text
        display="block"
        whiteSpace="nowrap"
        className={cn(
          'pointer-events-none absolute z-50 px-2 py-1 text-xs rounded-md bg-foreground text-background opacity-0 group-hover:opacity-100 transition-opacity duration-150 -translate-x-1/2 left-1/2',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </Prim.Text>
    </Prim.Text>
  );
}
