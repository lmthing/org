import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <Prim.Box
      role="separator"
      {...(orientation === 'horizontal'
        ? { height: 1, width: '100%' }
        : { width: 1, alignSelf: 'stretch' })}
      className={className} backgroundColor="$border" flexShrink={0}
    />
  );
}
