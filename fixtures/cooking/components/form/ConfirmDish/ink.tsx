import React from 'react';
import { Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  dish: string;
  onSubmit: (confirmed: boolean) => void;
}

export default function ConfirmDish({ dish, onSubmit }: Props) {
  return <Text>Confirm {dish}? (y/n): <TextInput value="" onChange={() => {}} onSubmit={v => onSubmit(v.toLowerCase() === 'y')} /></Text>;
}
