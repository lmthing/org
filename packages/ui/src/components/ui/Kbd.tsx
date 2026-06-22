import React from 'react';
import { cn } from '../../lib/cn.js';

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground text-xs font-mono',
        className
      )}
    >
      {children}
    </kbd>
  );
}
