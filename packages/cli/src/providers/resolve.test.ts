import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveModel } from './resolve.js';

describe('resolveModel custom OpenAI-compatible providers', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['MYTEST_API_TYPE', 'MYTEST_BASE_URL', 'MYTEST_API_KEY']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('resolves a custom provider when API_TYPE=openai and BASE_URL are set', async () => {
    process.env['MYTEST_API_TYPE'] = 'openai';
    process.env['MYTEST_BASE_URL'] = 'https://test.example.com/v1';
    const model = await resolveModel('mytest:model-x');
    expect(model).toBeTruthy();
  });

  it('includes API key when MYTEST_API_KEY is set', async () => {
    process.env['MYTEST_API_TYPE'] = 'openai';
    process.env['MYTEST_BASE_URL'] = 'https://test.example.com/v1';
    process.env['MYTEST_API_KEY'] = 'sk-test-key';
    const model = await resolveModel('mytest:model-x');
    expect(model).toBeTruthy();
  });

  it('throws when API_TYPE=openai but BASE_URL is missing', async () => {
    process.env['MYTEST_API_TYPE'] = 'openai';
    await expect(resolveModel('mytest:model-x')).rejects.toThrow('MYTEST_BASE_URL env var is required');
  });

  it('throws with hint when provider is unknown and no API_TYPE set', async () => {
    await expect(resolveModel('mytest:model-x')).rejects.toThrow('MYTEST_API_TYPE=openai');
  });

  it('throws unsupported error when API_TYPE is not openai', async () => {
    process.env['MYTEST_API_TYPE'] = 'unknown';
    await expect(resolveModel('mytest:model-x')).rejects.toThrow('Unsupported provider');
  });
});
