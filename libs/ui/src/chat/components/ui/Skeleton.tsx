import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Skeleton({ className }: { className?: string }) {
  return <Prim.Box className={cn("lm-pulse", className)} backgroundColor="$muted" borderRadius="$radius-md" />;
}
