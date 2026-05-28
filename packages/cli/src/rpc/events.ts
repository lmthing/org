export type ServerEvent =
  | { type: 'snapshot'; data: unknown }
  | { type: 'display'; descriptor: unknown }
  | { type: 'ask_start'; id: string; descriptor: unknown }
  | { type: 'ask_end'; id: string }
  | { type: 'variables'; vars: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type ClientMessage =
  | { type: 'sendMessage'; content: string }
  | { type: 'submitForm'; id: string; value: unknown }
  | { type: 'cancelAsk'; id: string };
