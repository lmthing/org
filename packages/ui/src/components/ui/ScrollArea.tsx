import React from 'react';
import { cn } from '../../lib/cn.js';

interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
}

export function ScrollArea({ children, className }: ScrollAreaProps) {
  return (
    <div className={cn('overflow-auto', className)}>
      {children}
    </div>
  );
}
