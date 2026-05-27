/**
 * Analyze an image using a vision-capable LLM.
 *
 * Sends a base64-encoded image to the configured vision model with a
 * structured extraction prompt. Returns the model's text response.
 *
 * Uses the Azure OpenAI provider via AI SDK v6.
 */

import { generateText } from "ai";
import { azure } from "@ai-sdk/azure";

export interface AnalyzeImageOpts {
  /** System prompt to set context. */
  system?: string;
  /** Max tokens in the response (default 4096). */
  maxOutputTokens?: number;
  /** Temperature (default 0.1 for structured extraction). */
  temperature?: number;
  /** MIME type of the image (default "image/jpeg"). */
  mimeType?: string;
}

export interface AnalyzeImageResult {
  /** The model's text response. */
  text: string;
  /** Model used for the call. */
  model: string;
  /** Token usage if available. */
  usage?: { promptTokens: number; completionTokens: number };
}

export async function analyzeImage(
  base64Data: string,
  prompt: string,
  opts: AnalyzeImageOpts = {},
): Promise<AnalyzeImageResult> {
  const modelId = process.env.LM_MODEL_L ?? "azure:gpt-5.4";
  const deploymentName = modelId.replace("azure:", "");

  const model = azure(deploymentName);

  const result = await generateText({
    model,
    system: opts.system ?? "You are a medical document extraction assistant. Extract all structured data accurately. Return JSON when possible.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: base64Data, mediaType: opts.mimeType ?? "image/jpeg" },
          { type: "text", text: prompt },
        ],
      },
    ],
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
    temperature: opts.temperature ?? 0.1,
  });

  return {
    text: result.text,
    model: modelId,
    usage: result.usage
      ? { promptTokens: result.usage.inputTokens ?? 0, completionTokens: result.usage.outputTokens ?? 0 }
      : undefined,
  };
}
