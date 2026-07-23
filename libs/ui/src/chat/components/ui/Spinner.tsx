import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <Prim.Text
      className={cn(
        'lm-spin inline-block border-2 border-current border-t-transparent rounded-full',
        className
      )}
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}
