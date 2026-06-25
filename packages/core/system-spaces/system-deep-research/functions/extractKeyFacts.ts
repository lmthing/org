export function extractKeyFacts(content: string, title: string): Array<{ fact: string; source: string }> {
  // Extract sentences that look like key facts (contain numbers, comparisons, or strong assertions)
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const keyFacts = sentences
    .filter(s => /\d|%|increase|decrease|show|found|study|research|according|report/i.test(s))
    .slice(0, 5)
    .map(s => ({ fact: s.trim(), source: title }));

  if (keyFacts.length === 0) {
    // Fallback: return first 3 sentences as facts
    return sentences.slice(0, 3).map(s => ({ fact: s.trim(), source: title }));
  }

  return keyFacts;
}
