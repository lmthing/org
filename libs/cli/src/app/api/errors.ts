/**
 * API **error contract** (Phase 3).
 *
 * The authored-handler API is {@link HttpError}: a handler throws
 * `new HttpError(status, message, details?)` and the runtime maps it to that
 * HTTP status with body `{ error: { status, message, details? } }`. Any other
 * throw is mapped to a generic `500` — the real error is logged pod-side by the
 * caller and **never** leaked in the body.
 *
 * Because api handlers run in a worker (a crash boundary — see 3A's `worker.ts`),
 * an `HttpError` cannot cross the thread boundary as a class instance
 * (`postMessage` structured-clone drops the prototype). So the worker
 * {@link serializeHttpError | serializes} it to a plain
 * `{ __httpError, status, message, details }` tag, posts that back, and the main
 * runtime feeds it to {@link errorResponseFor}, which reconstructs the response.
 */

/** Marker property on the serialized ({@link serializeHttpError}) form. */
const HTTP_ERROR_TAG = '__httpError' as const;

/**
 * The error an api handler throws to control the HTTP status of its response.
 * `instanceof HttpError` holds inside the handler process; across the worker
 * boundary use {@link serializeHttpError} / {@link isSerializedHttpError}.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
    // Preserve the prototype chain when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/** The wire/body shape every api error response carries. */
export interface ApiErrorBody {
  error: { status: number; message: string; details?: unknown };
}

/** The `postMessage`-safe plain-object form of an {@link HttpError}. */
export interface SerializedHttpError {
  __httpError: true;
  status: number;
  message: string;
  details?: unknown;
}

/**
 * Build an {@link ApiErrorBody}. `details` is omitted from the body when
 * `undefined` (so a bare error is `{ error: { status, message } }`).
 */
export function toErrorBody(status: number, message: string, details?: unknown): ApiErrorBody {
  const error: ApiErrorBody['error'] =
    details === undefined ? { status, message } : { status, message, details };
  return { error };
}

/** Serialize an {@link HttpError} into a structured-clone-safe tagged object. */
export function serializeHttpError(err: HttpError): SerializedHttpError {
  const out: SerializedHttpError = {
    [HTTP_ERROR_TAG]: true,
    status: err.status,
    message: err.message,
  };
  if (err.details !== undefined) out.details = err.details;
  return out;
}

/** Type guard for the serialized ({@link serializeHttpError}) form. */
export function isSerializedHttpError(x: unknown): x is SerializedHttpError {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as Record<string, unknown>)[HTTP_ERROR_TAG] === true &&
    typeof (x as Record<string, unknown>).status === 'number' &&
    typeof (x as Record<string, unknown>).message === 'string'
  );
}

/**
 * Map any thrown value to an HTTP status + body.
 *
 * - a live {@link HttpError} instance, OR its {@link serializeHttpError | serialized}
 *   form posted back from a worker → that status + `{ error: { status, message, details? } }`.
 * - anything else → `{ status: 500, body: 'internal error' }`. The caller is
 *   responsible for logging the real `err`; it is deliberately NOT placed in the
 *   body (never leak internal messages).
 */
export function errorResponseFor(err: unknown): { status: number; body: ApiErrorBody } {
  if (err instanceof HttpError) {
    return { status: err.status, body: toErrorBody(err.status, err.message, err.details) };
  }
  if (isSerializedHttpError(err)) {
    return { status: err.status, body: toErrorBody(err.status, err.message, err.details) };
  }
  return { status: 500, body: toErrorBody(500, 'internal error') };
}

/**
 * The fixed response for an ajv input-validation mismatch (Phase 4 wires the ajv
 * errors as `details`): `400` `{ error: { status: 400, message: 'invalid input',
 * details } }`.
 */
export function validationErrorBody(details: unknown): { status: number; body: ApiErrorBody } {
  return { status: 400, body: toErrorBody(400, 'invalid input', details) };
}
