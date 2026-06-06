export interface StreamOpts {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Optional model spec/alias override for this request. Forks set this from
   *  their role (see modelForRole); the provider layer resolves it, falling back
   *  to the session default when unset. */
  model?: string;
}

export interface StreamSession {
  textStream: AsyncIterable<string>;
  abort(): void;
}
