import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ className, error, ...props }: InputProps) {
  return (
    <Prim.TextField
      {...props}
      className={className} borderColor={error ? '$destructive' : '$border'} transition="quick" animateOnly={["color", "background-color", "border-color"]} width="100%" backgroundColor="$background" borderWidth={1} borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$1.5" fontSize="$sm" color="$foreground" placeholderTextColor="$muted-foreground" focusVisibleStyle={{ outlineWidth: 2, outlineStyle: "solid", outlineColor: "$ring" }} disabledStyle={{ opacity: 0.5 }}
    />
  );
}
