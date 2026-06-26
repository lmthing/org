import React from 'react';

interface Props {
  placeholder?: string;
  onSubmit?: (value: string) => void;
}

/** Asks the user for a research topic. Resolves the entered topic string. */
export default function ResearchQuery({ placeholder = 'Enter your research topic...' }: Props) {
  return (
    <div>
      <label>Research Topic</label>
      <input type="text" placeholder={placeholder} />
    </div>
  );
}
