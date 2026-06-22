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
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-brand-2/20 text-foreground font-medium shrink-0',
        className
      )}
      style={style}
    >
      {src ? (
        <img src={src} className="w-full h-full rounded-full object-cover" alt="" />
      ) : (
        fallback ?? '?'
      )}
    </span>
  );
}
