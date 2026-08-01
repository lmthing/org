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
      {/* Every `Prim.Box` here is an RN `View` — an RN View drops `fontFamily`/`fontSize`/
          `fontWeight`/`color` rather than passing them down, and there is no second level of
          rescue either: the OUTER Box's `fontFamily`/`fontSize` above are just as invisible to
          these nested `Prim.Text`s as the inner Box's own `fontWeight`/`color`, so every property
          any ancestor needs on the label has to be restated here directly. */}
      <Prim.Box fontWeight="bold" marginBottom={8} color="var(--muted-foreground)"><Prim.Text fontFamily="monospace" fontSize={13} fontWeight="bold" color="var(--muted-foreground)">VARIABLES</Prim.Text></Prim.Box>
      {entries.map(([name, value]) => (
        <Prim.Box key={name} marginBottom={4}>
          <Prim.Text fontFamily="monospace" fontSize={13} color="var(--agent)">{name}</Prim.Text>
          {': '}
          <Prim.Text fontFamily="monospace" fontSize={13} color="var(--knowledge)">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </Prim.Text>
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}
