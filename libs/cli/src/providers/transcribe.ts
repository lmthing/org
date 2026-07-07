import { experimental_transcribe as transcribe } from 'ai';

/** The transcription model spec, `provider:modelId`. Configurable via
 *  `LM_TRANSCRIBE_MODEL`; defaults to OpenAI Whisper. */
const DEFAULT_TRANSCRIBE_MODEL = 'openai:whisper-1';

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationInSeconds?: number;
}

/** Resolve a `provider:modelId` spec into an AI SDK transcription model.
 *  Supports openai and azure (both expose Whisper). Mirrors resolve.ts's env
 *  handling so credentials are shared. */
async function resolveTranscriptionModel(spec: string) {
  const idx = spec.indexOf(':');
  const provider = (idx === -1 ? 'openai' : spec.slice(0, idx)).toLowerCase();
  const modelId = idx === -1 ? spec : spec.slice(idx + 1);
  if (!modelId) throw new Error(`Invalid transcription model spec "${spec}"`);

  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const apiKey = process.env['OPENAI_API_KEY'];
      const baseURL = process.env['OPENAI_BASE_URL'];
      return createOpenAI(baseURL ? { baseURL, apiKey } : { apiKey }).transcription(modelId);
    }
    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure');
      const resourceName = process.env['AZURE_RESOURCE_NAME'];
      const apiKey = process.env['AZURE_API_KEY'];
      if (!resourceName) throw new Error('AZURE_RESOURCE_NAME env var is required for azure transcription');
      if (!apiKey) throw new Error('AZURE_API_KEY env var is required for azure transcription');
      return createAzure({ resourceName, apiKey }).transcription(modelId);
    }
    default:
      throw new Error(
        `Unsupported transcription provider "${provider}": supported providers are openai, azure`,
      );
  }
}

/** Transcribe audio bytes to text via the configured transcription model.
 *  Throws if no transcription provider is configured/credentialed. */
export async function transcribeAudio(audio: Uint8Array): Promise<TranscriptionResult> {
  const spec = process.env['LM_TRANSCRIBE_MODEL'] || DEFAULT_TRANSCRIBE_MODEL;
  const model = await resolveTranscriptionModel(spec);
  const result = await transcribe({ model, audio });
  return {
    text: result.text,
    ...(result.language ? { language: result.language } : {}),
    ...(typeof result.durationInSeconds === 'number' ? { durationInSeconds: result.durationInSeconds } : {}),
  };
}
