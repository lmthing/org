import { describe, it, expect } from 'vitest';
import { liteLlmDeepseekConfig, LITELLM_PROVIDER } from './litellm.js';

describe('liteLlmDeepseekConfig', () => {
  it('defaults base URL/key to the LiteLLM gateway and mirrors the model into the catalog', () => {
    const cfg = liteLlmDeepseekConfig({ model: 'DeepSeek-V4-Flash' }, {});
    expect(cfg.baseURL).toBe('https://lmthing.cloud/v1');
    expect(cfg.apiKeyEnv).toBe('LMTHINGCLOUD_API_KEY');
    expect(cfg.models).toEqual([{ id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000 }]);
  });

  it('honours LMTHINGCLOUD_BASE_URL from the environment', () => {
    const cfg = liteLlmDeepseekConfig({ model: 'm' }, { LMTHINGCLOUD_BASE_URL: 'http://litellm.internal/v1' });
    expect(cfg.baseURL).toBe('http://litellm.internal/v1');
  });

  it('lets explicit opts override env and defaults', () => {
    const cfg = liteLlmDeepseekConfig(
      { model: 'm', baseUrl: 'http://x/v1', apiKeyEnv: 'MY_KEY', contextWindow: 42 },
      { LMTHINGCLOUD_BASE_URL: 'http://ignored/v1' },
    );
    expect(cfg.baseURL).toBe('http://x/v1');
    expect(cfg.apiKeyEnv).toBe('MY_KEY');
    expect(cfg.models[0]?.contextWindow).toBe(42);
  });

  it('registers under the deepseek-official route', () => {
    expect(LITELLM_PROVIDER).toBe('deepseek-official');
  });
});
