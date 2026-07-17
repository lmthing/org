/**
 * asks.mjs — the driver's in-persona ask handler, as a REENTRANT class.
 *
 * When the agent asks mid-turn, the driver answers in-persona; the JUDGE later scores whether asking
 * was correct (and whether the answer was right). A step's `if_asked` map grounds the load-bearing
 * answers; consent is approved by default (a step may set `deny_consent: true`). Every ask + how it
 * was answered is recorded.
 *
 * This was module-global mutable state (`currentStep` + `asksThisStep`) closed over by a free
 * `onAsk` function — which meant one scenario per process. Encapsulating it in `StepAsks` makes the
 * engine reentrant: each `ScenarioRunner` owns its own instance, so two runs never share ask state.
 */
import { CANCEL_ASK } from '../harness/lib/thing.mjs';

export { CANCEL_ASK };

export class StepAsks {
  /** The active step (its `if_asked`/`deny_consent`/`cancel_ask` ground the answers). `{}` before
   *  the first step. */
  step = {};
  /** Every ask raised during the active step, and how it was answered. */
  log = [];

  /** Start a new step: make it active and clear the per-step ask log. */
  begin(step) {
    this.step = step ?? {};
    this.log = [];
  }

  /**
   * The onAsk handler passed straight to `ThingSession({ onAsk })`. Bound arrow so it can be handed
   * off without losing `this`. Returns the string answer (a boolean for consent, or the
   * `CANCEL_ASK` sentinel for a genuine dismiss).
   */
  onAsk = (descriptor) => {
    const text = JSON.stringify(descriptor ?? {});
    // Consent cards: approve unless the step opts into denial.
    if (descriptor?.type === 'ConsentCard') {
      const answer = this.step.deny_consent ? false : true;
      this.log.push({ kind: 'consent', answer, descriptor });
      return answer;
    }
    // Clarifying question / form: match the step's if_asked, else best-effort from its single entry.
    const ifAsked = this.step.if_asked ?? {};
    const keys = Object.keys(ifAsked);
    let matched =
      keys.find((k) => text.toLowerCase().includes(k.toLowerCase().slice(0, 24))) ??
      (keys.length === 1 ? keys[0] : undefined);
    // `cancel_ask: true` — the step wants a genuine DISMISS (DELETE → null) for any question
    // `if_asked` doesn't cover, never a silent '' answer (09-home-renovation's cancelled LogQuote
    // form: the ask must resolve WITHOUT a value, not by hanging and not by "answering" empty).
    if (!matched && this.step.cancel_ask) {
      this.log.push({ kind: 'question', matched: null, answer: CANCEL_ASK, cancelled: true, descriptor });
      return CANCEL_ASK;
    }
    const answer = matched ? ifAsked[matched] : '';
    this.log.push({ kind: 'question', matched: matched ?? null, answer, descriptor });
    // Return the string answer; unmatched → '' (recorded prominently so the judge sees an unhandled ask).
    return answer;
  };

  /** The asks raised during the active step (a fresh array, safe to store on the step record). */
  drain() {
    return [...this.log];
  }
}
