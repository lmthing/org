import { describe, it, expect } from 'vitest';
import { buildSystemBlock } from './system-block.js';
import type { Space, AgentDef } from '../spaces/load.js';

// A scoped agent function with a JSDoc comment and a uniquely-identifiable body.
const GREET_SRC = `/**
 * Greet a person by name in a chosen language.
 * Returns the formatted greeting string.
 */
export function greet(name: string, lang: 'en' | 'es'): string {
  const UNIQUE_BODY_TOKEN = lang === 'es' ? 'Hola' : 'Hello';
  return UNIQUE_BODY_TOKEN + ', ' + name;
}`;

function makeSpace(functions: Record<string, string>): Space {
  return {
    dir: '/tmp/fake',
    agents: {},
    tasklists: {},
    functions,
    functionsBundled: {},
    dependentSpaces: {},
    components: { view: {}, form: {} },
    knowledge: { domains: {} } as Space['knowledge'],
  };
}

function makeAgent(functionNames: string[]): AgentDef {
  return {
    slug: 'main',
    title: 'Main',
    instructBody: 'Do the thing.',
    actions: [],
    canDelegateTo: [],
    config: { knowledge: [], functions: functionNames, components: [] },
  };
}

describe('buildSystemBlock — Available Functions section', () => {
  it('renders agent functions as signature + JSDoc, NOT full source', () => {
    const space = makeSpace({ greet: GREET_SRC });
    const block = buildSystemBlock({ space, agent: makeAgent(['greet']), directDeps: [] });

    expect(block).toContain('# Available Functions');
    // Signature is present (params + return type).
    expect(block).toContain('greet(name: string, lang: \'en\' | \'es\'): string');
    // Description from the JSDoc is present.
    expect(block).toContain('Greet a person by name in a chosen language.');
    // The implementation body must NOT leak into the prompt.
    expect(block).not.toContain('UNIQUE_BODY_TOKEN');
    // No fenced full-source block for the function any more.
    expect(block).not.toContain('## greet');
  });

  it('omits the section entirely when the agent declares no functions', () => {
    const space = makeSpace({ greet: GREET_SRC });
    const block = buildSystemBlock({ space, agent: makeAgent([]), directDeps: [] });
    expect(block).not.toContain('# Available Functions');
  });

  it('does not list a function twice when it is also a Built-in Tool (system space run directly)', () => {
    // When the running space IS a system space, its function is in BOTH the
    // agent's functions AND systemFunctions — it must appear only once.
    const space = makeSpace({ greet: GREET_SRC });
    const block = buildSystemBlock({
      space,
      agent: makeAgent(['greet']),
      directDeps: [],
      systemFunctions: { greet: GREET_SRC },
    });
    const sig = 'greet(name: string, lang: \'en\' | \'es\'): string';
    const occurrences = block.split(sig).length - 1;
    expect(occurrences).toBe(1);
    // It stays under Built-in Tools; the now-empty Available Functions is dropped.
    expect(block).toContain('# Built-in Tools');
    expect(block).not.toContain('# Available Functions');
  });
});
