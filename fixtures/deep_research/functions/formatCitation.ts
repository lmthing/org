export function formatCitation(title: string, url: string, accessed?: string): string {
  const date = accessed ?? new Date().toISOString().split('T')[0];
  return `${title}. Retrieved ${date}, from ${url}`;
}
