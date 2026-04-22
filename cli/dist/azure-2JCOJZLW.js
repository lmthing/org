import {
  defineProvider
} from "./chunk-OMBSAIUZ.js";

// src/providers/azure.ts
import { createAzure } from "@ai-sdk/azure";
var module = defineProvider({
  name: "azure",
  envKey: "AZURE_API_KEY",
  sdkFactory: createAzure,
  mapConfig: (config) => ({
    apiKey: config.apiKey,
    resourceName: config.resourceName || process.env.AZURE_RESOURCE_NAME,
    baseURL: config.baseURL
  }),
  models: {}
});
var createAzureProvider = module.createProvider;
var azure = (deploymentId) => module.provider.chat(deploymentId);
export {
  azure,
  createAzureProvider
};
