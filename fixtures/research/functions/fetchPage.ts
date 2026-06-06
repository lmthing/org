export function fetchPage(url: string): { url: string; content: string; wordCount: number } {
  // Simulated page content
  const domain = url.split('/')[2] ?? 'example.com';
  const path = url.split('/').slice(3).join(' ').replace(/-/g, ' ');
  const content = `This is the content from ${domain} about "${path}". The article discusses key findings, methodologies, and conclusions. It includes data points, expert quotes, and references to related research. The content is approximately 800 words covering the main topic thoroughly.`;
  return { url, content, wordCount: 120 };
}
