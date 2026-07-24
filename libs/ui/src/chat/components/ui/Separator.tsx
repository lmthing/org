import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <Prim.Box
      role="separator"
      className={cn(orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch', className)} backgroundColor="$border" flexShrink={0}
    />
  );
}
