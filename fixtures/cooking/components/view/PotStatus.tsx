import React from 'react';

interface Props {
  temperature: number;
  boiling: boolean;
}

export default function PotStatus({ temperature, boiling }: Props) {
  return (
    <div>
      <h3>Pot Status</h3>
      <p>Temperature: {temperature}°C</p>
      <p>{boiling ? '🔥 Boiling!' : 'Not yet boiling'}</p>
    </div>
  );
}
