import React from 'react';
import { Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  onSubmit: (value: number) => void;
}

export default function SaltinessSlider({ onSubmit }: Props) {
  return (
    <Text>Saltiness (1-10): <TextInput value="" onChange={() => {}} onSubmit={v => onSubmit(Number(v))} /></Text>
  );
}
