/** Shared path constants. The harness lives at <repo>/sdk/org/scenarios/harness/. */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // …/harness/lib
export const HARNESS_DIR = resolve(here, '..');
export const SCENARIOS_DIR = resolve(HARNESS_DIR, '..');
export const SDK_ORG = resolve(SCENARIOS_DIR, '..');
export const REPO_ROOT = resolve(SDK_ORG, '..', '..');

/** Per-run scratch state (test users, transcripts). Gitignored. */
export const STATE_DIR = resolve(HARNESS_DIR, '.state');
