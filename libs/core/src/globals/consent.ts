import { randomUUID } from 'node:crypto';
import type { YieldRequest } from '../eval/yield.js';
import type { RenderHost } from '../session/types.js';

/**
 * Generic HOST-ENFORCED function consent (plan S10).
 *
 * A `consent`-marked function's invocation must be approved by the USER before
 * it executes — enforced in host code, unbypassable by the model:
 *
 *   - A consent-marked GLOBAL (a yield kind listed in
 *     {@link CONSENT_MARKED_YIELD_KINDS}, e.g. `installSpace`) is intercepted in
 *     the shared yield router BEFORE its resolver runs: the router calls the
 *     session's {@link ConsentPrompter} (which rides the `renderHost.ask`
 *     plumbing — the consent card is an ask form) and only resolves the yield on
 *     approval. Denial rejects the yield with a structured refusal the agent sees.
 *
 *   - A consent-marked SPACE FUNCTION (a `functions/*.ts` whose LEADING comment
 *     carries the `@consent` pragma — see {@link functionRequiresConsent}) is
 *     WRAPPED at injection time (`sandbox/inject-functions.ts`): the original
 *     implementation is hidden in a closure and the exposed global first awaits
 *     the host-injected `__requestConsent` seam ({@link createConsentRequestGlobal}),
 *     which pushes a `consent` yield. The impl runs only after the host approves;
 *     sandbox code can never reach the unwrapped function.
 *
 * Non-interactive contexts (headless runs, forks, delegates, hooks) have no
 * {@link ConsentPrompter} wired into their yield-router context, so a
 * consent-marked invocation there FAILS CLOSED with a clear error — never
 * silently executes and never hangs on an ask no user will answer.
 */

/** The structured consent card the host renders for approval. `argsSummary` is
 *  built HOST-side (never trusted from sandbox strings beyond display). */
export interface ConsentCard {
  /** The function/global being invoked (e.g. `installSpace`). */
  function: string;
  /** The owning space label, when known (space-function consent). */
  space?: string;
  /** Compact human-readable rendering of the call's arguments. */
  argsSummary: string;
}

/** Host-side consent prompter — resolves `true` only when the USER approved the
 *  card. Supplied ONLY by interactive session contexts (the cli wires it from
 *  `renderHost.ask`); absent everywhere else so consent fails closed. */
export type ConsentPrompter = (card: ConsentCard) => Promise<boolean>;

/**
 * The consent-marked GLOBAL registry: yield KINDS that must pass the consent
 * gate before their resolver runs. This is the "consent flag on a global's
 * definition" — the single seam the yield router consults. `installSpace` is
 * consumer #1 (plan S10); add a kind here to consent-mark another global.
 */
export const CONSENT_MARKED_YIELD_KINDS: ReadonlySet<string> = new Set(['installSpace']);

/** Cap the rendered argument summary so a hostile/huge payload can't flood the
 *  consent card (approval must stay reviewable at a glance). */
const ARGS_SUMMARY_MAX_CHARS = 300;

/** Compact, truncated JSON rendering of a call's arguments for the consent card.
 *  Best-effort — an unserializable value falls back to String(). */
export function summarizeConsentArgs(args: unknown[]): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    text = String(args);
  }
  if (text.length > ARGS_SUMMARY_MAX_CHARS) text = text.slice(0, ARGS_SUMMARY_MAX_CHARS) + '…';
  return text;
}

/** The fail-closed error for a consent-marked call in a context with no user to
 *  ask (headless runs, forks, delegates, hooks). */
export function consentUnavailableError(fn: string): Error {
  return new Error(
    `"${fn}" requires user consent — run it from an interactive session (this context has no user to ask, so the call is refused)`,
  );
}

/** The structured refusal the agent sees when the user declines the card. */
export function consentDeniedError(fn: string): Error {
  return new Error(
    `consent denied: the user declined "${fn}" — do not retry it unless the user explicitly asks for it`,
  );
}

/**
 * The single enforcement primitive: run the consent gate for `card`. No prompter
 * (non-interactive context) ⇒ FAIL CLOSED; prompter answers false ⇒ structured
 * refusal. Returns only on explicit approval.
 */
export async function enforceConsent(
  prompter: ConsentPrompter | undefined,
  card: ConsentCard,
): Promise<void> {
  if (!prompter) throw consentUnavailableError(card.function);
  const granted = await prompter(card);
  if (!granted) throw consentDeniedError(card.function);
}

/**
 * Does a space function's source opt into host-enforced consent? True when a
 * LEADING comment (JSDoc block or `//` line, before any code) carries the
 * `@consent` pragma. Function files are plain `.ts` with no frontmatter, so the
 * leading-comment pragma is where function metadata naturally lives (detected on
 * the ORIGINAL TS source — bundling may strip comments). An `@consent` inside
 * the function body does NOT count.
 */
export function functionRequiresConsent(source: string): boolean {
  let i = 0;
  const n = source.length;
  while (i < n) {
    while (i < n && /\s/.test(source[i]!)) i++;
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      const line = end === -1 ? source.slice(i) : source.slice(i, end);
      if (/@consent\b/.test(line)) return true;
      i = end === -1 ? n : end + 1;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i);
      const block = end === -1 ? source.slice(i) : source.slice(i, end);
      if (/@consent\b/.test(block)) return true;
      i = end === -1 ? n : end + 2;
    } else {
      break; // first non-comment token — leading trivia is over
    }
  }
  return false;
}

/**
 * Create the internal `__requestConsent` seam consent-wrapped SPACE FUNCTIONS
 * call before running their hidden impl (see `sandbox/inject-functions.ts`).
 * Value-yielding: it pushes a `consent` yield carrying the HOST-built card and
 * resolves only when the router's consent gate approved. Injected into EVERY VM
 * (session/fork/delegate) but deliberately absent from the ambient DTS — model
 * code never calls it directly (and a stray call merely asks for consent).
 */
export function createConsentRequestGlobal(
  pushYield: (req: YieldRequest) => void,
  spaceLabel?: string,
): (functionName: string, args: unknown[]) => Promise<{ granted: true }> {
  return function __requestConsent(functionName: string, args: unknown[]): Promise<{ granted: true }> {
    const card: ConsentCard = {
      function: String(functionName),
      ...(spaceLabel ? { space: spaceLabel } : {}),
      argsSummary: summarizeConsentArgs(Array.isArray(args) ? args : [args]),
    };
    return new Promise<{ granted: true }>((resolve, reject) => {
      pushYield({
        kind: 'consent',
        args: [card],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}

/** Is an `ask` submission an approval? `true`/`'approve'`/`{ approved: true }`
 *  (or `{ approve: true }`) count; anything else — including `null` from a
 *  cancelled ask — is a denial. */
export function isConsentApproval(value: unknown): boolean {
  if (value === true || value === 'approve') return true;
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    return v['approved'] === true || v['approve'] === true;
  }
  return false;
}

/**
 * Build a {@link ConsentPrompter} on the `renderHost.ask` plumbing — the consent
 * card rides the same ask channel interactive forms use (`ask_start` →
 * user submit → `ask_end`), rendered as a `ConsentCard` descriptor. The cli
 * wires this ONLY for interactive sessions; headless/fork/delegate contexts get
 * no prompter and fail closed in {@link enforceConsent}.
 */
export function createAskConsentPrompter(renderHost: Pick<RenderHost, 'ask'>): ConsentPrompter {
  return async (card: ConsentCard): Promise<boolean> => {
    const descriptor = {
      type: 'ConsentCard',
      props: {
        function: card.function,
        ...(card.space ? { space: card.space } : {}),
        argsSummary: card.argsSummary,
      },
      children: [],
    };
    const value = await renderHost.ask(randomUUID(), descriptor);
    return isConsentApproval(value);
  };
}
