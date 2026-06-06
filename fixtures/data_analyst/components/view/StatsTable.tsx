import React from 'react';

interface Props {
  title: string;
  stats: Record<string, number | string>;
}

export default function StatsTable({ title, stats }: Props) {
  return (
    <div className="stats-table">
      <h3>{title}</h3>
      <table>
        <tbody>
          {Object.entries(stats).map(([key, value]) => (
            <tr key={key}>
              <td><strong>{key}</strong></td>
              <td>{typeof value === 'number' ? value.toFixed(2) : value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
