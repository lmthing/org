/**
 * `setActivity` — the live "currently doing" status the agent updates WHILE it
 * works. Unlike `setSessionMeta` (which names the conversation and, like `ask`,
 * ends the turn), this is FIRE-AND-FORGET: it runs as a bridged host function,
 * calls the host `onActivity` hook synchronously, and returns immediately — it
 * never pushes a yield, so it does NOT abort the streaming statement pipeline or
 * end the turn. That is what lets THING bump its status inline mid-work without
 * burning a turn (exactly like `display`/`writeKnowledge`).
 *
 * Scope is decided HOST-side by which VM emits it: the top-level session drives
 * the MAIN activity line; a fork/delegate sub-run drives a SUB-activity keyed by
 * its node. An empty string clears that scope's activity.
 *
 * Usage in model-generated TS:
 *   setActivity('Searching for recipes…');
 *   // …later…
 *   setActivity('Comparing 3 options');
 */
export function createSetActivityGlobal(
  onActivity: (text: string) => void,
): (text: string) => void {
  return function setActivity(text: string): void {
    // Coerce defensively — the model surface is `string`, but a stray non-string
    // must not throw inside a bridged host call (that would abort the statement).
    onActivity(typeof text === 'string' ? text : text == null ? '' : String(text));
  };
}
