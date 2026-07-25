import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export function Avatar({
  src,
  fallback,
  size = 28,
  className,
}: {
  src?: string;
  fallback?: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: size * 0.4 };

  return (
    <Prim.Text
      display="inline-flex"
      className={cn("bg-brand-2/20", className)} alignItems="center" justifyContent="center" borderRadius="$radius-full" color="$foreground" fontWeight="$medium" flexShrink={0}
      style={style}
    >
      {src ? (
        <Prim.Image src={src} width="100%" height="100%" borderRadius="$radius-full" objectFit="cover" alt="" />
      ) : (
        fallback ?? '?'
      )}
    </Prim.Text>
  );
}
