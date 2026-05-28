import { appendFileSync } from 'node:fs';

export type TraceEvent =
  | { ts: number; type: 'session_start'; sessionId: string }
  | { ts: number; type: 'statement'; code: string }
  | { ts: number; type: 'yield'; kind: string; args: unknown }
  | { ts: number; type: 'error'; message: string; attempt: number }
  | { ts: number; type: 'turn_end'; reason: string };

export class Tracer {
  constructor(private path: string | null) {}

  write(event: TraceEvent): void {
    if (this.path === null) return;
    try {
      appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8');
    } catch {
      // best-effort tracing — ignore write errors
    }
  }
}
