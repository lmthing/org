import { generateAppTypes, type EndpointContract } from './schema.js';
import { makeValidatorMap } from './validate.js';
import { buildApiCallDts } from './apicall-dts.js';
import { X_OPTIONS_KEYWORD, readXOptions, type XOptions } from '../view-spec/schema.js';
import type { InputValidator } from '../api/input.js';

/**
 * The Phase-4 typed-contract bundle for one project, generated ONCE from its `api/` +
 * `database/` (heavy — `ts-json-schema-generator`), then reused across requests/sessions:
 *  - `validators` → the api runtime's per-endpoint ajv input validation (consumer 2)
 *  - `apiCallDts` → the agent's typed `apiCall` overloads in its ambient DTS (consumer 3)
 *  - `generatedDts` → written to `<projectRoot>/types/generated.d.ts` (consumers 1 + 4:
 *    handler tsc + page client row/IO types)
 *  - `endpoints` → the raw contracts (tool signatures, manifest)
 *  - `formOptions` → per-endpoint `x-options` annotations (consumer 5: the view renderer's
 *    schema-form — see {@link collectFormOptions})
 */
export interface ProjectContracts {
  endpoints: EndpointContract[];
  validators: Map<string, InputValidator>;
  apiCallDts: string;
  generatedDts: string;
  /** `endpointName → inputProperty → XOptions`. Empty for a project with no annotations. */
  formOptions: Record<string, Record<string, XOptions>>;
}

/**
 * Collect every well-formed `x-options` annotation the Input schemas carry.
 *
 * The annotation reaches the schema because `./schema.ts` asks the generator to keep the tag
 * (`extraTags`); this pass is what makes it USABLE and safe. A `create` section declares no form
 * fields — they derive from the mutation's Input schema — so the only place "where do this
 * field's options come from" can live is that same contract, and the renderer reads it from here
 * rather than re-parsing handler sources.
 *
 * **Malformed annotations are dropped, not thrown.** They arrive from a JSDoc comment an agent
 * wrote, so a stray one is an authoring typo; failing the whole contract generation over it would
 * take the entire app's build down for a form-field hint. A dropped annotation degrades to exactly
 * what the field would have been without it (a plain text input), which is visible and harmless.
 */
export function collectFormOptions(endpoints: EndpointContract[]): Record<string, Record<string, XOptions>> {
  const out: Record<string, Record<string, XOptions>> = {};
  for (const ep of endpoints) {
    const props = (ep.inputSchema as Record<string, unknown>)['properties'];
    if (!props || typeof props !== 'object') continue;
    const perField: Record<string, XOptions> = {};
    for (const [field, schema] of Object.entries(props as Record<string, unknown>)) {
      const raw = readXOptions(schema);
      if (!raw) continue;
      if (typeof raw.query !== 'string' || typeof raw.label !== 'string' || typeof raw.value !== 'string') {
        // Keep the schema itself clean so nothing downstream trusts a half-written annotation.
        delete (schema as Record<string, unknown>)[X_OPTIONS_KEYWORD];
        continue;
      }
      perField[field] = raw;
    }
    if (Object.keys(perField).length) out[ep.name] = perField;
  }
  return out;
}

/** Generate the full typed-contract bundle for a project. Call on save/boot, not per request. */
export async function generateProjectContracts(projectRoot: string): Promise<ProjectContracts> {
  const { generatedDts, endpoints } = await generateAppTypes(projectRoot);
  const formOptions = collectFormOptions(endpoints);
  return {
    endpoints,
    validators: makeValidatorMap(endpoints),
    // STRICT for the agent DTS (no generic fallback) — a wrong name OR wrong input type
    // must fail the agent's typecheck. Empty endpoints ⇒ '' ⇒ the session falls back to
    // the generic apiCall fragment (@lmthing/core API_CALL_DTS).
    apiCallDts: buildApiCallDts(endpoints, { fallback: false }),
    generatedDts,
    formOptions,
  };
}
