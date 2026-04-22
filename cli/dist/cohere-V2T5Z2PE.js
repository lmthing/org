import {
  defineProvider
} from "./chunk-OMBSAIUZ.js";

// src/providers/cohere.ts
import { createCohere } from "@ai-sdk/cohere";
var module = defineProvider({
  name: "cohere",
  envKey: "COHERE_API_KEY",
  sdkFactory: createCohere,
  models: {
    COMMAND_R_PLUS: "command-r-plus",
    COMMAND_R: "command-r",
    COMMAND: "command",
    COMMAND_LIGHT: "command-light"
  }
});
var createCohereProvider = module.createProvider;
var cohere = module.provider;
var CohereModels = module.models;
export {
  CohereModels,
  cohere,
  createCohereProvider
};
