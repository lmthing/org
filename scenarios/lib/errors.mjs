/**
 * A FatalError is a run-ending condition whose message is meant for the user AS-IS — the CLI shim
 * prints `run-yaml: <message>` with NO stack (matching the old `fail()`), whereas any other throw
 * prints its full stack. Kept in its own leaf module so both `scenario.mjs` (load failure) and
 * `runner.mjs` (server-not-up) can throw it without a dependency cycle.
 */
export class FatalError extends Error {}
