import React from 'react';

interface Props {
  placeholder?: string;
  label?: string;
  onSubmit?: (value: string) => void;
}

export default function QueryForm({ placeholder = 'Enter your research query...', label = 'Research Query' }: Props) {
  return (
    <div>
      <label>{label}</label>
      <input type="text" placeholder={placeholder} />
    </div>
  );
}
