import React from 'react';

interface Props {
  dish: string;
  onSubmit: (confirmed: boolean) => void;
}

export default function ConfirmDish({ dish, onSubmit }: Props) {
  return (
    <div>
      <p>Confirm dish: {dish}?</p>
      <button onClick={() => onSubmit(true)}>Yes</button>
      <button onClick={() => onSubmit(false)}>No</button>
    </div>
  );
}
