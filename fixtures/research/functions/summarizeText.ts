export function summarizeText(text: string, maxSentences: number = 3): string {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.slice(0, maxSentences).join('. ') + '.';
}
