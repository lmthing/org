import type { HostToolsProfile } from '../globals/host-tools.js';

/**
 * Subagent roles. A fork is an isolated VM whose parent sees only the value it
 * passes to currentTask.resolve() — a natural context firewall. Roles specialize
 * that firewall: a read-only preamble + a host-tools capability profile so
 * read-only roles physically cannot mutate (write is withheld at injection, not
 * merely discouraged in the prompt).
 */
export type ForkRole = 'explore' | 'plan' | 'general';

/** Shared tail appended to every role — the load-bearing context-economy instruction. */
const FIREWALL_TAIL = [
  'You are a subagent running in an ISOLATED context. Your parent sees ONLY the',
  'object you pass to currentTask.resolve() — not what you read, run, or print.',
  'NEVER resolve with raw file contents or command output — always synthesize.',
  'Read and search as much as you need, then resolve a CONCISE synthesis:',
  'conclusions, specific file paths and line numbers that matter, and only the',
  'snippets that are load-bearing. 2-3 sentences of synthesis beats 500 lines of',
  'raw dump. If a tool call fails (ok: false), report the error honestly — do not',
  'guess or fabricate content you did not actually read.',
  '',
  'SCOPE: Each TypeScript statement is an isolated module. Variables declared in one',
  'statement are NOT visible in the next. Declare and use a variable in the same',
  'statement, or assign it to a well-known global. Never split a `let`/`const` declaration',
  'from its first use across two separate statements.',
].join('\n');

const PREAMBLES: Record<ForkRole, string> = {
  explore: [
    'ROLE: EXPLORE (read-only). You investigate and answer a specific question.',
    'You may read files (readFile), search (grep, glob), list dirs (listDir), run',
    'read-only shell commands, and search the web (webSearch/webFetch). You MUST NOT',
    'write, edit, move, or delete anything — write tools and mutating shell commands',
    'are blocked and will return an error. Return findings, not file dumps.',
    '',
    FIREWALL_TAIL,
  ].join('\n'),
  plan: [
    'ROLE: PLAN (read-only architect). You design an implementation plan for review.',
    'You may read and search but MUST NOT modify anything (write tools and mutating',
    'shell commands are blocked). Resolve an object with the plan and the most',
    'critical file paths — do not implement.',
    '',
    FIREWALL_TAIL,
  ].join('\n'),
  general: [
    'ROLE: GENERAL. You have the full toolkit (read, write, edit, search, shell, web).',
    '',
    FIREWALL_TAIL,
  ].join('\n'),
};

export function normalizeRole(role: string | undefined): ForkRole {
  return role === 'explore' || role === 'plan' ? role : 'general';
}

/**
 * Per-role model assignment. Lets cheap roles (explore/plan — read-only,
 * high-throughput) run on a cheaper model while general forks use the capable
 * default. Values are model specs or aliases resolved by the provider layer.
 */
export type RoleModelConfig = Partial<Record<ForkRole, string>>;

/** The model spec/alias for a role, or undefined to use the session default. */
export function modelForRole(role: string | undefined, config?: RoleModelConfig): string | undefined {
  if (!config) return undefined;
  return config[normalizeRole(role)];
}

/** The system-prompt preamble for a role. */
export function rolePreamble(role: string | undefined): string {
  return PREAMBLES[normalizeRole(role)];
}

/** The host-tools capability profile for a role (read-only for explore/plan). */
export function roleProfile(role: string | undefined): HostToolsProfile {
  const r = normalizeRole(role);
  return { allowWrite: r === 'general' };
}
