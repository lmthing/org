/**
 * Disk-driven session driver — domain-agnostic.
 *
 * Loads a space, picks an agent (`agents/<slug>/instruct.md`) and a flow
 * (`flows/<slug>/index.md` + step files), composes the system prompt from
 * those files plus the library + auto-discovered overlay `.d.ts`, and drives
 * the LLM through the flow's cycles until the flow's declared sink fires.
 */
export { runSpaceSession } from "./session.js";
export type {
  RunSpaceSessionOptions,
  RunSpaceSessionResult,
  SessionManifest,
  CycleRecord,
  ExecutedStatement,
} from "./session.js";
export { resolveLLM, type ModelAlias } from "./model.js";
