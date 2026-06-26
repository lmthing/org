import React from 'react';

interface Props {
  placeholder?: string;
  label?: string;
  onSubmit?: (value: string) => void;
}

export default function DatasetQuery({ placeholder = 'Describe what you want to analyze...', label = 'Analysis Query' }: Props) {
  return (
    <div>
      <label>{label}</label>
      <input type="text" placeholder={placeholder} />
    </div>
  );
}
