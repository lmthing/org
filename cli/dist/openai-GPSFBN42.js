import {
  defineProvider
} from "./chunk-OMBSAIUZ.js";

// src/providers/openai.ts
import { createOpenAI } from "@ai-sdk/openai";
var OpenAIModelsObj = {
  GPT4O: "gpt-4o",
  GPT4O_MINI: "gpt-4o-mini",
  GPT4_TURBO: "gpt-4-turbo",
  GPT4: "gpt-4",
  GPT35_TURBO: "gpt-3.5-turbo",
  O1_PREVIEW: "o1-preview",
  O1_MINI: "o1-mini"
};
var module = defineProvider({
  name: "openai",
  envKey: "OPENAI_API_KEY",
  sdkFactory: createOpenAI,
  mapConfig: (config) => ({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    organization: config.organization,
    project: config.project
  }),
  models: OpenAIModelsObj
});
var createOpenAIProvider = module.createProvider;
var openai = module.provider;
var OpenAIModels = OpenAIModelsObj;
export {
  OpenAIModels,
  createOpenAIProvider,
  openai
};
