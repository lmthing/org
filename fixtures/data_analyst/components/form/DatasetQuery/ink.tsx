import React from 'react';
import { Text, Box } from 'ink';

interface Props {
  placeholder?: string;
  label?: string;
  onSubmit?: (value: string) => void;
}

export default function DatasetQuery({ placeholder = 'Describe what you want to analyze...', label = 'Analysis Query' }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold color="yellow">{label}</Text>
      <Text dimColor>{placeholder}</Text>
    </Box>
  );
}
