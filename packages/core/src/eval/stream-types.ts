export interface StreamOpts {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface StreamSession {
  textStream: AsyncIterable<string>;
  abort(): void;
}
