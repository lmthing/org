/**
 * Append-only trace.jsonl writer.
 * Each event is a JSON line: { ts, type, ...fields }
 */
import { appendFileSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TraceEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

export class TraceWriter {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    // Ensure parent directory exists
    mkdirSync(dirname(filePath), { recursive: true });
  }

  write(event: Omit<TraceEvent, 'ts'>): void {
    const line = JSON.stringify({ ts: Date.now(), ...event }) + '\n';
    // Open in append mode, write, fsync, close
    const fd = openSync(this.filePath, 'a');
    try {
      appendFileSync(this.filePath, line, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Read back trace events starting from a given line offset (0-based).
   */
  readSuffix(fromLine: number): TraceEvent[] {
    let content: string;
    try {
      content = readFileSync(this.filePath, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const slice = lines.slice(fromLine);
    const events: TraceEvent[] = [];

    for (const line of slice) {
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch {
        // Skip malformed lines
      }
    }

    return events;
  }
}
