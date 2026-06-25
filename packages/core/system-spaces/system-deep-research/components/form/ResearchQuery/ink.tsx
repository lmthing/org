import React from 'react';
import { Text, Box } from 'ink';

interface Props {
  placeholder?: string;
  onSubmit?: (value: string) => void;
}

export default function ResearchQuery({ placeholder = 'Enter your research topic...' }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Research Topic</Text>
      <Text dimColor>{placeholder}</Text>
    </Box>
  );
}
