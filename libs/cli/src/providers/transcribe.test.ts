import { describe, it, expect, afterEach } from 'vitest';
import { transcribeAudio } from './transcribe.js';

const savedEnv = process.env['LM_TRANSCRIBE_MODEL'];
afterEach(() => {
  if (savedEnv === undefined) delete process.env['LM_TRANSCRIBE_MODEL'];
  else process.env['LM_TRANSCRIBE_MODEL'] = savedEnv;
});

describe('transcribeAudio provider resolution', () => {
  it('rejects an unsupported transcription provider before any network call', async () => {
    process.env['LM_TRANSCRIBE_MODEL'] = 'bogus:whatever';
    await expect(transcribeAudio(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /Unsupported transcription provider/,
    );
  });

  it('requires the LiteLLM key when lmthingcloud is configured', async () => {
    process.env['LM_TRANSCRIBE_MODEL'] = 'lmthingcloud:whisper-1';
    const savedKey = process.env['LMTHINGCLOUD_API_KEY'];
    delete process.env['LMTHINGCLOUD_API_KEY'];
    try {
      await expect(transcribeAudio(new Uint8Array([1]))).rejects.toThrow(/LMTHINGCLOUD_API_KEY/);
    } finally {
      if (savedKey !== undefined) process.env['LMTHINGCLOUD_API_KEY'] = savedKey;
    }
  });

  it('requires azure credentials when azure is configured', async () => {
    process.env['LM_TRANSCRIBE_MODEL'] = 'azure:whisper';
    const savedResource = process.env['AZURE_RESOURCE_NAME'];
    delete process.env['AZURE_RESOURCE_NAME'];
    try {
      await expect(transcribeAudio(new Uint8Array([1]))).rejects.toThrow(/AZURE_RESOURCE_NAME/);
    } finally {
      if (savedResource !== undefined) process.env['AZURE_RESOURCE_NAME'] = savedResource;
    }
  });
});
