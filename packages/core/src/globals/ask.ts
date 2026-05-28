import type { YieldRequest } from '../eval/yield.js';
import type { RenderHost } from '../session/types.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

// Component allowlist for form elements (block dangerous ones)
const BLOCKED_TYPES = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'frame',
  'frameset',
]);

interface JSXDescriptor {
  type: string | ((...args: unknown[]) => unknown);
  props: Record<string, unknown>;
  children: JSXDescriptor[];
}

function isJSXDescriptor(v: unknown): v is JSXDescriptor {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    'props' in v &&
    'children' in v
  );
}

function validateDescriptor(desc: JSXDescriptor): void {
  const type = typeof desc.type === 'string' ? desc.type.toLowerCase() : '';

  if (BLOCKED_TYPES.has(type)) {
    throw new Error(`ask(): blocked descriptor type "${type}"`);
  }

  // Block dangerouslySetInnerHTML
  if (desc.props['dangerouslySetInnerHTML'] !== undefined) {
    throw new Error('ask(): dangerouslySetInnerHTML is not allowed');
  }

  // Block javascript: URLs in href/src/action
  for (const [key, val] of Object.entries(desc.props)) {
    if (typeof val === 'string' && val.trim().toLowerCase().startsWith('javascript:')) {
      throw new Error(`ask(): javascript: URL not allowed in prop "${key}"`);
    }
  }

  // Recursively validate children
  if (Array.isArray(desc.children)) {
    for (const child of desc.children) {
      if (isJSXDescriptor(child)) validateDescriptor(child);
    }
  }
}

/**
 * Create the `ask` global. It validates the descriptor, pushes a yield request,
 * and returns a Promise that resolves when the render surface submits a value.
 */
export function createAskGlobal(
  pushYield: (req: YieldRequest) => void,
  _renderHost: RenderHost,
  _timeoutMs = DEFAULT_TIMEOUT_MS,
): (descriptor: unknown) => Promise<unknown> {
  return function ask(descriptor: unknown): Promise<unknown> {
    if (!isJSXDescriptor(descriptor)) {
      return Promise.reject(new Error('ask(): argument must be a JSX descriptor'));
    }

    try {
      validateDescriptor(descriptor);
    } catch (err) {
      return Promise.reject(err);
    }

    const id = randomUUID();

    // Push the yield — processYield in session.ts will call renderHost.ask
    return new Promise((resolve, reject) => {
      pushYield({
        kind: 'ask',
        args: [id, descriptor],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
