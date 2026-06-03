import React from 'react';
import { Text, Box } from 'ink';

interface Props {
  placeholder?: string;
  label?: string;
  onSubmit?: (value: string) => void;
}

export default function QueryForm({ placeholder = 'Enter your research query...', label = 'Research Query' }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Text dimColor>{placeholder}</Text>
    </Box>
  );
}
