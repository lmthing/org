/**
 * `node:sqlite`, reached through `createRequire`.
 *
 * Vite 5.4 predates `node:sqlite` in its list of Node builtins, so it strips the `node:` prefix and
 * tries to resolve a PACKAGE called `sqlite` — which fails to load every suite that touches the
 * project data store. `createRequire` asks Node directly, which has always been able to answer.
 *
 * Aliased in `vitest.config.ts`. Delete this the moment the toolchain knows the module.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sqlite = require('node:sqlite')

export const DatabaseSync = sqlite.DatabaseSync
export const StatementSync = sqlite.StatementSync
export default sqlite
