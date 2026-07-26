/**
 * ConsentCard renderer — the host-enforced function-consent UI.
 *
 * Renders the `{ type: 'ConsentCard', props: { function, space?, argsSummary } }`
 * ask descriptor and proves Approve/Deny wire to the resolve convention
 * (approve → `true`, deny → `false`) so the agent never hangs.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
// The provider-wrapped render: post-Tamagui every primitive calls `useTheme()`
// and throws `Missing theme.` outside one.
import { render } from '../../test-utils/index';
import {
  ConsentCard,
  isConsentDescriptor,
  consentPropsFromDescriptor,
} from './ConsentCard';

const consentDescriptor = {
  type: 'ConsentCard',
  props: { function: 'installSpace', space: 'system-global', argsSummary: '["weather-space"]' },
  children: [],
};

describe('isConsentDescriptor', () => {
  it('matches only the ConsentCard descriptor', () => {
    expect(isConsentDescriptor(consentDescriptor)).toBe(true);
    expect(isConsentDescriptor({ type: 'Form', props: {}, children: [] })).toBe(false);
    expect(isConsentDescriptor('plain string')).toBe(false);
    expect(isConsentDescriptor(null)).toBe(false);
  });
});

describe('consentPropsFromDescriptor', () => {
  it('extracts function/space/argsSummary', () => {
    expect(consentPropsFromDescriptor(consentDescriptor)).toEqual({
      fn: 'installSpace',
      space: 'system-global',
      argsSummary: '["weather-space"]',
    });
  });

  it('falls back to a readable function label when absent', () => {
    expect(consentPropsFromDescriptor({ type: 'ConsentCard', props: {}, children: [] })).toEqual({
      fn: 'this function',
    });
  });
});

describe('ConsentCard', () => {
  it('renders the function, space and args summary', () => {
    const { container } = render(
      <ConsentCard
        fn="installSpace"
        space="system-global"
        argsSummary='["weather-space"]'
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain('THING wants to run');
    expect(html).toContain('installSpace');
    expect(html).toContain('system-global');
    expect(html).toContain('weather-space');
    // design tokens only — no raw color literals
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it('fires onApprove / onDeny handlers', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    // Render through React test-node to click; use static handlers directly.
    const approve = ConsentCard({ fn: 'installSpace', onApprove, onDeny });
    // Walk the element tree to find the two buttons by testid.
    const buttons: Array<Record<string, unknown>> = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const el = node as { props?: Record<string, unknown> };
      const props = el.props;
      if (props) {
        if (props['data-testid'] === 'consent-approve') buttons[0] = props;
        if (props['data-testid'] === 'consent-deny') buttons[1] = props;
        const kids = props['children'];
        if (Array.isArray(kids)) kids.forEach(walk);
        else walk(kids);
      }
    };
    walk(approve);
    (buttons[0]!['onClick'] as () => void)();
    (buttons[1]!['onClick'] as () => void)();
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
