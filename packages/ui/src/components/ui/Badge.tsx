import React from 'react';
import { cn } from '../../lib/cn.js';

type BadgeVariant = 'default' | 'muted' | 'knowledge' | 'agent' | 'destructive' | 'brand';

const bv: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  muted: 'bg-muted text-muted-foreground',
  knowledge: 'bg-knowledge/15 text-knowledge',
  agent: 'bg-agent/15 text-agent',
  destructive: 'bg-destructive/15 text-destructive',
  brand: 'bg-brand-2/20 text-foreground',
};

export function Badge({
  variant = 'muted',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium',
        bv[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
