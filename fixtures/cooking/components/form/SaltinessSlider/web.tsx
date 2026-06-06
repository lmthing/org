import React from 'react';

interface Props {
  onSubmit: (value: number) => void;
}

export default function SaltinessSlider({ onSubmit }: Props) {
  return (
    <div>
      <label>Saltiness level (1-10):</label>
      <input type="range" min={1} max={10} onChange={e => onSubmit(Number(e.target.value))} />
    </div>
  );
}
