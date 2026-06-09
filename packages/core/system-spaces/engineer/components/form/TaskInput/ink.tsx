import React from 'react';
import { Text, Box } from 'ink';

interface Props {
  placeholder?: string;
  onSubmit?: (value: string) => void;
}

export default function TaskInput({ placeholder = 'Describe the coding task…' }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Engineer</Text>
      <Text dimColor>{placeholder}</Text>
    </Box>
  );
}
