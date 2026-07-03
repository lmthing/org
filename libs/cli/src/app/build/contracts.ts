import { generateAppTypes, type EndpointContract } from './schema.js';
import { makeValidatorMap } from './validate.js';
import { buildApiCallDts } from './apicall-dts.js';
import type { InputValidator } from '../api/input.js';

/**
 * The Phase-4 typed-contract bundle for one project, generated ONCE from its `api/` +
 * `database/` (heavy — `ts-json-schema-generator`), then reused across requests/sessions:
 *  - `validators` → the api runtime's per-endpoint ajv input validation (consumer 2)
 *  - `apiCallDts` → the agent's typed `apiCall` overloads in its ambient DTS (consumer 3)
 *  - `generatedDts` → written to `<projectRoot>/types/generated.d.ts` (consumers 1 + 4:
 *    handler tsc + page client row/IO types)
 *  - `endpoints` → the raw contracts (tool signatures, manifest)
 */
export interface ProjectContracts {
  endpoints: EndpointContract[];
  validators: Map<string, InputValidator>;
  apiCallDts: string;
  generatedDts: string;
}

/** Generate the full typed-contract bundle for a project. Call on save/boot, not per request. */
export async function generateProjectContracts(projectRoot: string): Promise<ProjectContracts> {
  const { generatedDts, endpoints } = await generateAppTypes(projectRoot);
  return {
    endpoints,
    validators: makeValidatorMap(endpoints),
    // STRICT for the agent DTS (no generic fallback) — a wrong name OR wrong input type
    // must fail the agent's typecheck. Empty endpoints ⇒ '' ⇒ the session falls back to
    // the generic apiCall fragment (@lmthing/core API_CALL_DTS).
    apiCallDts: buildApiCallDts(endpoints, { fallback: false }),
    generatedDts,
  };
}
