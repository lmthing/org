import { appendFileSync } from 'node:fs';

export type TraceEvent =
  | { ts: number; type: 'session_start'; sessionId: string; spaceDir: string; agentSlug: string }
  | { ts: number; type: 'llm_request'; context: string; system: string; messages: Array<{ role: string; content: string }> }
  | { ts: number; type: 'llm_response'; context: string; attempt: number; text: string }
  | { ts: number; type: 'statement'; context: string; code: string }
  | { ts: number; type: 'typecheck_error'; context: string; statement: string; message: string; attempt: number }
  | { ts: number; type: 'eval_error'; context: string; statement: string; message: string }
  | { ts: number; type: 'yield'; context: string; kind: string; args: unknown }
  | { ts: number; type: 'yield_resolved'; context: string; kind: string; value: unknown }
  | { ts: number; type: 'turn_end'; context: string; reason: string };

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

export const NULL_TRACER = new Tracer(null);
