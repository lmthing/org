import React from 'react';

interface VariablesBlockProps {
  vars: Record<string, unknown>;
}

export function VariablesBlock({ vars }: VariablesBlockProps): React.ReactElement {
  const entries = Object.entries(vars);

  return (
    <div
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
      <div style={{ fontWeight: 'bold', marginBottom: 8, color: 'var(--muted-foreground)' }}>VARIABLES</div>
      {entries.map(([name, value]) => (
        <div key={name} style={{ marginBottom: 4 }}>
          <span style={{ color: 'var(--agent)' }}>{name}</span>
          {': '}
          <span style={{ color: 'var(--knowledge)' }}>
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </span>
        </div>
      ))}
    </div>
  );
}
