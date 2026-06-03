import React from 'react';
import { Text, Box } from 'ink';

interface Props {
  placeholder?: string;
  onSubmit?: (value: string) => void;
}

export default function BrowseRequest({ placeholder = 'Enter URL or search query...' }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold color="green">Browser Task</Text>
      <Text dimColor>{placeholder}</Text>
    </Box>
  );
}
