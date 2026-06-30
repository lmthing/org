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
        backgroundColor: '#f8f9fa',
        border: '1px solid #dee2e6',
        borderRadius: 4,
        padding: 12,
        fontFamily: 'monospace',
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#6c757d' }}>VARIABLES</div>
      {entries.map(([name, value]) => (
        <div key={name} style={{ marginBottom: 4 }}>
          <span style={{ color: '#0d6efd' }}>{name}</span>
          {': '}
          <span style={{ color: '#198754' }}>
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </span>
        </div>
      ))}
    </div>
  );
}
