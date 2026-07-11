import React from 'react';
import { isDescriptor } from './render-descriptor.js';
import type { Descriptor } from './render-descriptor.js';

/**
 * Consent-card renderer for the host-enforced function-consent flow
 * (`@lmthing/core` `globals/consent.ts`). A consent-marked call (e.g.
 * `installSpace`, or a space function tagged `@consent`) rides the `renderHost.ask`
 * channel as a descriptor:
 *
 *   { type: 'ConsentCard', props: { function, space?, argsSummary } }
 *
 * The user's choice resolves the ask via the ordinary form-submit path:
 *   - Approve → submit `true` → host `isConsentApproval` grants the call.
 *   - Deny    → submit `false` (or a cancelled ask → `null`) → host refuses.
 *
 * Both choices RESOLVE the ask, so a denied/closed card never leaves the agent
 * hanging. This component is surface-agnostic (chat + studio THING dock) and
 * uses only design-system tokens.
 */

/** Is `d` the host-emitted consent-card ask descriptor? */
export function isConsentDescriptor(d: unknown): d is Descriptor {
  return isDescriptor(d) && d.type === 'ConsentCard';
}

export interface ConsentCardProps {
  /** The function/global awaiting consent (e.g. `installSpace`). */
  fn: string;
  /** The owning space label, when known. */
  space?: string;
  /** Compact host-built summary of the call arguments. */
  argsSummary?: string;
  /** Disable the buttons once the card has been answered/cancelled. */
  inert?: boolean;
  /** Grant consent (host resolves the ask as approved). */
  onApprove: () => void;
  /** Refuse consent (host resolves the ask as denied). */
  onDeny: () => void;
}

function ShieldIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 mt-0.5 text-agent"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function ConsentCard({
  fn,
  space,
  argsSummary,
  inert,
  onApprove,
  onDeny,
}: ConsentCardProps): React.ReactElement {
  return (
    <div
      data-testid="consent-card"
      className="border border-agent/50 bg-agent/5 rounded-xl p-4 my-1"
    >
      <div className="flex items-start gap-2">
        <ShieldIcon />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            THING wants to run{' '}
            <code className="font-mono text-agent break-all">{fn}</code>
          </div>
          {space && (
            <div className="text-xs text-muted-foreground mt-0.5">
              space: <span className="font-mono">{space}</span>
            </div>
          )}
        </div>
      </div>

      {argsSummary && (
        <pre className="text-xs font-mono text-muted-foreground bg-muted rounded-lg px-2 py-1.5 mt-2 overflow-x-auto whitespace-pre-wrap break-words">
          {argsSummary}
        </pre>
      )}

      <div className="text-xs text-muted-foreground mt-2 mb-3">
        Approve to let THING run this once, or deny to refuse it.
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={inert}
          onClick={onApprove}
          data-testid="consent-approve"
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={inert}
          onClick={onDeny}
          data-testid="consent-deny"
          className="px-3 py-1.5 border border-border text-foreground rounded-lg text-sm disabled:opacity-50 hover:bg-muted transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

/** Pull typed consent props off a `ConsentCard` descriptor's `props` bag. */
export function consentPropsFromDescriptor(d: Descriptor): {
  fn: string;
  space?: string;
  argsSummary?: string;
} {
  const p = d.props ?? {};
  const fn = typeof p['function'] === 'string' ? (p['function'] as string) : 'this function';
  const space = typeof p['space'] === 'string' ? (p['space'] as string) : undefined;
  const argsSummary =
    typeof p['argsSummary'] === 'string' ? (p['argsSummary'] as string) : undefined;
  return { fn, ...(space ? { space } : {}), ...(argsSummary ? { argsSummary } : {}) };
}
