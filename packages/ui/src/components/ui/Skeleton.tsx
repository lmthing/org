import React from 'react';
import { cn } from '../../lib/cn.js';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-muted rounded-md lm-pulse', className)} />;
}
