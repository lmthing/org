/**
 * Build an error block for injection into the message history after a failed statement.
 */
export function buildErrorBlock(
  failingStatement: string,
  message: string,
  attempt: number,
  maxRetries = 3,
): string {
  const lines = [
    `ERROR (attempt ${attempt} of ${maxRetries})`,
    `// ${failingStatement.split('\n').join('\n// ')}`,
    `// ${message}`,
  ];
  return lines.join('\n');
}
