import React from 'react';

interface Props {
  title: string;
  data: Record<string, number>;
  type?: 'bar' | 'pie';
}

export default function DataChart({ title, data, type = 'bar' }: Props) {
  const max = Math.max(...Object.values(data));
  return (
    <div className="chart">
      <h3>{title} ({type})</h3>
      {Object.entries(data).map(([label, value]) => (
        <div key={label} className="bar-row">
          <span className="label">{label}</span>
          <span className="bar" style={{ width: `${(value / max) * 100}%` }} />
          <span className="value">{value}</span>
        </div>
      ))}
    </div>
  );
}
