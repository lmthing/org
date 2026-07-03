/**
 * API error contract ({@link ./errors.ts}) — HttpError carries status/details;
 * errorResponseFor maps HttpError (live + serialized) to its status and hides
 * non-HttpError messages behind a generic 500; validationErrorBody is a fixed
 * typed 400.
 */
import { describe, it, expect } from 'vitest';
import {
  HttpError,
  toErrorBody,
  errorResponseFor,
  serializeHttpError,
  isSerializedHttpError,
  validationErrorBody,
} from './errors.js';

describe('HttpError', () => {
  it('carries status, message and details', () => {
    const err = new HttpError(422, 'bad', { field: 'x' });
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(422);
    expect(err.message).toBe('bad');
    expect(err.details).toEqual({ field: 'x' });
  });
});

describe('toErrorBody', () => {
  it('omits details when undefined', () => {
    expect(toErrorBody(404, 'nope')).toEqual({ error: { status: 404, message: 'nope' } });
  });
  it('includes details when present', () => {
    expect(toErrorBody(400, 'invalid input', [1])).toEqual({
      error: { status: 400, message: 'invalid input', details: [1] },
    });
  });
});

describe('errorResponseFor', () => {
  it('maps a live HttpError to its status + body', () => {
    expect(errorResponseFor(new HttpError(404, 'nope'))).toEqual({
      status: 404,
      body: { error: { status: 404, message: 'nope' } },
    });
  });

  it('carries HttpError details through', () => {
    expect(errorResponseFor(new HttpError(409, 'conflict', { id: 1 }))).toEqual({
      status: 409,
      body: { error: { status: 409, message: 'conflict', details: { id: 1 } } },
    });
  });

  it('hides a non-HttpError behind a generic 500 (never leaks the message)', () => {
    const res = errorResponseFor(new Error('secret db string'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { status: 500, message: 'internal error' } });
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('treats a thrown string/primitive as a generic 500', () => {
    expect(errorResponseFor('boom')).toEqual({
      status: 500,
      body: { error: { status: 500, message: 'internal error' } },
    });
  });
});

describe('serialize / isSerialized round-trip across a simulated postMessage', () => {
  it('reconstructs an HttpError from its posted-back plain-object form', () => {
    const original = new HttpError(403, 'forbidden', { reason: 'scope' });
    // Simulate structured-clone over postMessage (drops the class prototype).
    const wire = JSON.parse(JSON.stringify(serializeHttpError(original)));
    expect(isSerializedHttpError(wire)).toBe(true);
    expect(wire).not.toBeInstanceOf(HttpError);
    expect(errorResponseFor(wire)).toEqual({
      status: 403,
      body: { error: { status: 403, message: 'forbidden', details: { reason: 'scope' } } },
    });
  });

  it('serializes without details cleanly', () => {
    const wire = serializeHttpError(new HttpError(404, 'nope'));
    expect(wire).toEqual({ __httpError: true, status: 404, message: 'nope' });
    expect('details' in wire).toBe(false);
  });

  it('isSerializedHttpError rejects non-tagged shapes', () => {
    expect(isSerializedHttpError(null)).toBe(false);
    expect(isSerializedHttpError({ status: 404, message: 'nope' })).toBe(false);
    expect(isSerializedHttpError({ __httpError: true, status: '404', message: 'x' })).toBe(false);
    expect(isSerializedHttpError({ __httpError: true, status: 404 })).toBe(false);
  });
});

describe('validationErrorBody', () => {
  it('is a fixed 400 "invalid input" carrying the ajv details', () => {
    const details = [{ instancePath: '/id', message: 'must be number' }];
    expect(validationErrorBody(details)).toEqual({
      status: 400,
      body: { error: { status: 400, message: 'invalid input', details } },
    });
  });
});
