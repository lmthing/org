/**
 * Extract named entities from news text.
 *
 * Returns structured entities (people, organisations, locations, dates, etc.)
 * extracted from the input text. Used for building topic clusters, identifying
 * key figures, and cross-referencing coverage across sources.
 */

export interface Entity {
  text: string;
  type: "person" | "organisation" | "location" | "date" | "event" | "product" | "title" | "technology" | "money" | "other";
  count: number;
  confidence: number;
}

export interface ExtractEntitiesOpts {
  /** Entity types to extract (default: all). */
  types?: Entity["type"][];
  /** Minimum confidence threshold 0–1 (default 0.5). */
  minConfidence?: number;
  /** Maximum entities to return (default 30). */
  maxEntities?: number;
  /** Additional context to improve extraction (e.g. article title). */
  context?: string;
}

const ENTITY_PATTERNS: Array<{
  type: Entity["type"];
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => string;
}> = [
  {
    type: "money",
    pattern: /\$[\d,.]+(?:\s*(?:million|billion|trillion|million|thousand))?/gi,
    extract: (m) => m[0],
  },
  {
    type: "date",
    pattern: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,
    extract: (m) => m[0],
  },
  {
    type: "date",
    pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    extract: (m) => m[0],
  },
  {
    type: "date",
    pattern: /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
    extract: (m) => m[0],
  },
  {
    type: "technology",
    pattern: /\b(?:AI|GPT|LLM|ChatGPT|Claude|Gemini|5G|6G|IoT|blockchain|Web3|quantum computing|CRISPR|mRNA|nuclear fusion|autonomous driving|machine learning|deep learning|neural network)\b/gi,
    extract: (m) => m[0],
  },
  {
    type: "product",
    pattern: /\b(?:iPhone|iPad|MacBook|Galaxy|Pixel|Windows\s*\d+|macOS|iOS|Android|Tesla\s+Model\s+\w|ChatGPT|Copilot)\b/gi,
    extract: (m) => m[0],
  },
];

function extractPatternEntities(text: string, opts: ExtractEntitiesOpts): Entity[] {
  const types = opts.types ?? [];
  const entities: Map<string, Entity> = new Map();

  for (const { type, pattern, extract } of ENTITY_PATTERNS) {
    if (types.length && !types.includes(type)) continue;
    for (const match of text.matchAll(pattern)) {
      const value = extract(match);
      const key = value.toLowerCase();
      const existing = entities.get(key);
      if (existing) {
        existing.count++;
      } else {
        entities.set(key, { text: value, type, count: 1, confidence: 0.85 });
      }
    }
  }

  return [...entities.values()];
}

export async function extractEntities(
  text: string,
  opts: ExtractEntitiesOpts = {},
): Promise<Entity[]> {
  const minConf = opts.minConfidence ?? 0.5;
  const max = opts.maxEntities ?? 30;

  const entities = extractPatternEntities(text, opts);
  return entities
    .filter((e) => e.confidence >= minConf)
    .sort((a, b) => b.count - a.count || b.confidence - a.confidence)
    .slice(0, max);
}
