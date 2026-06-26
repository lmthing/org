import React from 'react';

interface Props {
  placeholder?: string;
  onSubmit?: (value: string) => void;
}

export default function BrowseRequest({ placeholder = 'Enter URL or search query...' }: Props) {
  return (
    <div>
      <label>Browse Request</label>
      <input type="text" placeholder={placeholder} />
    </div>
  );
}
