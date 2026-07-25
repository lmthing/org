import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <Prim.Text
      display="inline-block"
      className={cn("lm-spin", className)} borderWidth={2} borderColor="$t-transparent" borderRadius="$radius-full"
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}
