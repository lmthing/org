import * as Prim from '../../elements/primitives/index.js';
import React from 'react';

interface VariablesBlockProps {
  vars: Record<string, unknown>;
}

export function VariablesBlock({ vars }: VariablesBlockProps): React.ReactElement {
  const entries = Object.entries(vars);

  return (
    <Prim.Box
      className="repl-variables"
      style={{
        backgroundColor: 'var(--muted)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 12,
        fontFamily: 'monospace',
        fontSize: 13,
      }}
    >
      <Prim.Box style={{ fontWeight: 'bold', marginBottom: 8, color: 'var(--muted-foreground)' }}>VARIABLES</Prim.Box>
      {entries.map(([name, value]) => (
        <Prim.Box key={name} style={{ marginBottom: 4 }}>
          <Prim.Text style={{ color: 'var(--agent)' }}>{name}</Prim.Text>
          {': '}
          <Prim.Text style={{ color: 'var(--knowledge)' }}>
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </Prim.Text>
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}
