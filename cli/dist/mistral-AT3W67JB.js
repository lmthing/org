import {
  defineProvider
} from "./chunk-OMBSAIUZ.js";

// src/providers/mistral.ts
import { createMistral } from "@ai-sdk/mistral";
var module = defineProvider({
  name: "mistral",
  envKey: "MISTRAL_API_KEY",
  sdkFactory: createMistral,
  models: {
    LARGE_LATEST: "mistral-large-latest",
    MEDIUM_LATEST: "mistral-medium-latest",
    SMALL_LATEST: "mistral-small-latest",
    TINY: "mistral-tiny",
    CODESTRAL: "codestral-latest",
    MIXTRAL_8X7B: "open-mixtral-8x7b",
    MIXTRAL_8X22B: "open-mixtral-8x22b"
  }
});
var createMistralProvider = module.createProvider;
var mistral = module.provider;
var MistralModels = module.models;
export {
  MistralModels,
  createMistralProvider,
  mistral
};
