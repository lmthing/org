import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Skeleton({ className }: { className?: string }) {
  return <Prim.Box className={cn('bg-muted rounded-md lm-pulse', className)} />;
}
