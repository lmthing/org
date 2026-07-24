import * as Prim from '../../../elements/primitives/index.js';
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
    <Prim.Text as="kbd"
      display="inline-flex"
      className={className} alignItems="center" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius" borderWidth={1} borderColor="$border" backgroundColor="$muted" color="$muted-foreground" fontSize="$xs" fontFamily="$mono"
    >
      {children}
    </Prim.Text>
  );
}
