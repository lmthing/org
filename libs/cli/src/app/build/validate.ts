/**
 * Build-time **ajv input validators** (Phase 4, typed-contract pipeline consumer 2).
 *
 * The api runtime holds one {@link InputValidator} per endpoint (Phase 3 shipped
 * {@link passThroughValidator}). Here we compile each endpoint's declared
 * `inputSchema` ONCE at build time into an ajv-backed validator. On a request the
 * runtime hands the assembled Input (path params + query/body — see
 * `../api/input.js`) to the endpoint's validator, which coerces in place
 * (`coerceTypes: true` turns a GET's query-string `"true"` → boolean, `"5"` →
 * number, a `[id]` path-param string → number when the schema says so) and
 * returns the coerced value, or the ajv errors as `details` for the typed 400.
 */

import Ajv from 'ajv';
import { X_OPTIONS_KEYWORD } from '../view-spec/schema.js';
import type { InputValidator } from '../api/input.js';
import type { EndpointContract } from './schema.js';

/**
 * ajv v8 is a CJS package with no `exports` map, so under `moduleResolution:
 * NodeNext` its default import resolves to the **module namespace** object, not
 * the `export default class Ajv`. The real constructor is `Ajv.default`; the
 * `?? Ajv` fallback covers the classic esModuleInterop shape where the default
 * import already IS the class. Typed against the named `Ajv` class so `new`
 * stays constructable.
 */
const AjvCtor: typeof import('ajv').Ajv =
  (Ajv as unknown as { default?: typeof import('ajv').Ajv }).default ??
  (Ajv as unknown as typeof import('ajv').Ajv);

/**
 * One shared ajv instance for the whole build. `coerceTypes` performs the
 * string→scalar coercion the method-aware Input assembly relies on;
 * `allErrors` collects every failure for the 400 `details`; `useDefaults`
 * fills schema-declared defaults into the coerced value.
 */
const ajv = new AjvCtor({ coerceTypes: true, allErrors: true, useDefaults: true });

/**
 * `x-options` is an ANNOTATION, not a constraint — it tells the view renderer's schema-form where
 * a foreign-key field's options come from (`../view-spec/schema.ts#XOptions`), and says nothing
 * about whether a request is valid.
 *
 * Declaring it here is not optional decoration: ajv v8 runs in strict mode by default and THROWS
 * on an unknown keyword at compile time, so an endpoint carrying the annotation would take down
 * `makeValidatorMap` — and with it every endpoint's input validation — the moment an api author
 * wrote one. Registered with no `validate`/`code`, so it costs nothing per request.
 */
ajv.addKeyword({ keyword: X_OPTIONS_KEYWORD });

/**
 * Compile a single endpoint `inputSchema` into an {@link InputValidator}.
 *
 * Compilation happens once (call this at build time, not per request). ajv
 * **mutates the input in place** with coercion + defaults, so the returned
 * `value` IS the coerced object.
 */
export function makeInputValidator(inputSchema: object): InputValidator {
  const validate = ajv.compile(inputSchema);
  return (input) => {
    if (validate(input)) return { ok: true, value: input };
    return { ok: false, details: validate.errors };
  };
}

/**
 * Compile every endpoint's `inputSchema` up front into a lookup the integrator
 * installs into the api runtime. Keyed **both** by endpoint `name` and by
 * `"<METHOD> <routePath>"` so the runtime can resolve a validator by whichever
 * handle it holds. All schemas are compiled once here — never per request.
 */
export function makeValidatorMap(endpoints: EndpointContract[]): Map<string, InputValidator> {
  const map = new Map<string, InputValidator>();
  for (const ep of endpoints) {
    const validator = makeInputValidator(ep.inputSchema);
    map.set(ep.name, validator);
    map.set(`${ep.method} ${ep.routePath}`, validator);
  }
  return map;
}
