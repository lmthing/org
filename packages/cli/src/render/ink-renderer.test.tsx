import React from 'react';
import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { renderDescriptor } from './ink-renderer.js';

function desc(type: string, children: unknown[] = [], props: Record<string, unknown> = {}) {
  return { type, props, children };
}

describe('renderDescriptor', () => {
  it('renders known block elements as Box', () => {
    const el = renderDescriptor(desc('p', ['hello'])) as React.ReactElement;
    expect(el.type).toBe(Box);
  });

  it('renders unknown element types as Box, not Text', () => {
    const el = renderDescriptor(desc('div', [])) as React.ReactElement;
    expect(el.type).toBe(Box);
  });

  it('does not nest Box inside Text for div > p', () => {
    // div renders as Box; p renders as Box inside Box — no Box-inside-Text
    const el = renderDescriptor(desc('div', [desc('p', ['hello'])])) as React.ReactElement;
    expect(el.type).toBe(Box);
  });

  it('renders span as Text', () => {
    const el = renderDescriptor(desc('span', ['hi'])) as React.ReactElement;
    expect(el.type).toBe(Text);
  });

  it('renders h1 as Text', () => {
    const el = renderDescriptor(desc('h1', ['Title'])) as React.ReactElement;
    expect(el.type).toBe(Text);
  });

  it('renders plain string as Text', () => {
    const el = renderDescriptor('hello') as React.ReactElement;
    expect(el.type).toBe(Text);
  });
});
