import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { cn } from '../../lib/cn';

interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
}

export function ScrollArea({ children, className }: ScrollAreaProps) {
  return (
    <Prim.Box className={className} overflow="auto">
      {children}
    </Prim.Box>
  );
}
