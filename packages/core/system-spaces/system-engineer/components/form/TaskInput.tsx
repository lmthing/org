import React from 'react';

interface Props {
  placeholder?: string;
  onSubmit: (value: string) => void;
}

/** Asks the user to describe the coding task to work on. Resolves the task text. */
export default function TaskInput({ placeholder = 'Describe the coding task…', onSubmit }: Props) {
  const [value, setValue] = React.useState('');
  return (
    <div>
      <label>Coding task</label>
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
      />
      <button onClick={() => onSubmit(value)}>Start</button>
    </div>
  );
}
