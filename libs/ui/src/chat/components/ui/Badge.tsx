import * as Prim from '../../../elements/primitives/index.js';
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
    <Prim.Text
      {...props}
      display="inline-flex"
      className={cn(bv[variant], className)} alignItems="center" gap="$1" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full" fontSize="$xs" fontWeight="$medium"
    >
      {children}
    </Prim.Text>
  );
}
