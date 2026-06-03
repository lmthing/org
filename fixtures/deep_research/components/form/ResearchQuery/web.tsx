import React from 'react';

interface Props {
  placeholder?: string;
  onSubmit?: (value: string) => void;
}

export default function ResearchQuery({ placeholder = 'Enter your research topic...' }: Props) {
  return (
    <div>
      <label>Research Topic</label>
      <input type="text" placeholder={placeholder} />
    </div>
  );
}
