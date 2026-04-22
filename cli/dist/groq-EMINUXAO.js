import {
  defineProvider
} from "./chunk-OMBSAIUZ.js";

// src/providers/groq.ts
import { createGroq } from "@ai-sdk/groq";
var module = defineProvider({
  name: "groq",
  envKey: "GROQ_API_KEY",
  sdkFactory: createGroq,
  models: {
    LLAMA_3_3_70B_VERSATILE: "llama-3.3-70b-versatile",
    LLAMA_3_1_70B_VERSATILE: "llama-3.1-70b-versatile",
    LLAMA_3_1_8B_INSTANT: "llama-3.1-8b-instant",
    LLAMA_3_2_90B_VISION: "llama-3.2-90b-vision-preview",
    MIXTRAL_8X7B: "mixtral-8x7b-32768",
    GEMMA_7B: "gemma-7b-it",
    GEMMA_2_9B: "gemma2-9b-it"
  }
});
var createGroqProvider = module.createProvider;
var groq = module.provider;
var GroqModels = module.models;
export {
  GroqModels,
  createGroqProvider,
  groq
};
