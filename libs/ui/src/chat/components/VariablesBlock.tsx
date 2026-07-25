import * as Prim from '../../elements/primitives/index';
import React from 'react';

interface VariablesBlockProps {
  vars: Record<string, unknown>;
}

export function VariablesBlock({ vars }: VariablesBlockProps): React.ReactElement {
  const entries = Object.entries(vars);

  return (
    <Prim.Box
      backgroundColor="var(--muted)" borderWidth="1px" borderStyle="solid" borderColor="var(--border)" borderRadius={4} padding={12} fontFamily="monospace" fontSize={13}
    >
      <Prim.Box fontWeight="bold" marginBottom={8} color="var(--muted-foreground)">VARIABLES</Prim.Box>
      {entries.map(([name, value]) => (
        <Prim.Box key={name} marginBottom={4}>
          <Prim.Text color="var(--agent)">{name}</Prim.Text>
          {': '}
          <Prim.Text color="var(--knowledge)">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </Prim.Text>
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}
