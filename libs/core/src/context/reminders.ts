/**
 * Generic, reusable per-turn reminder mechanism.
 *
 * A *soft* reminder is a transient note appended to a single model request (never
 * written to history), re-evaluated fresh EVERY turn so it can never be "forgotten"
 * and never duplicates. It is the host's channel for gently keeping the agent on
 * track — open todos, an unnamed session, an unmet obligation — without hard-failing
 * the turn.
 *
 * The registry composes any number of independent providers into one reminder block.
 * Add a new reminder by registering a provider; the turn loop needs no changes (the
 * session already wires `ReminderRegistry.collect()` as its `beforeTurn` hook).
 */

/** A per-turn reminder provider. Returns the reminder text to surface THIS turn, or
 *  `undefined`/empty when it has nothing to add. Runs every turn — keep it cheap and
 *  free of turn-visible side effects. May throw; the registry isolates failures. */
export type ReminderProvider = () => string | undefined;

export class ReminderRegistry {
  private providers: ReminderProvider[] = [];

  /** Register a reminder provider. Chainable. */
  add(provider: ReminderProvider): this {
    this.providers.push(provider);
    return this;
  }

  /**
   * Run every provider and join the non-empty results into one reminder block
   * (blank-line separated, in registration order). Returns `undefined` when no
   * provider has anything to say. A provider that throws is skipped — one broken
   * reminder must never break the turn.
   */
  collect(): string | undefined {
    const parts: string[] = [];
    for (const provider of this.providers) {
      let out: string | undefined;
      try {
        out = provider();
      } catch {
        out = undefined; // a misbehaving reminder is silently skipped, never fatal
      }
      if (out && out.trim()) parts.push(out.trim());
    }
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  /** Number of registered providers (for tests/introspection). */
  get size(): number {
    return this.providers.length;
  }
}
