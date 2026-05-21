/**
 * Analyzer — Phase 12
 *
 * Single-turn XS model call that classifies incoming user messages
 * to inform the router's difficulty-based branching.
 */
import { generateText } from 'ai';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import type { TraceWriter } from '@lmthing/llm-repl/lib/sandbox/trace';

export interface AnalyzerResult {
  difficulty: 'simple' | 'moderate' | 'complex';
  skip_planner: boolean;
  estimated_tasks: number;
  needs_fork: boolean;
  needs_ask: boolean;
  rationale: string;
}

const ANALYZER_SYSTEM_PROMPT = `You are a task analyzer. Respond with valid JSON only, no markdown.
Analyze the user message and return:
{
  "difficulty": "simple" | "moderate" | "complex",
  "skip_planner": boolean,
  "estimated_tasks": number,
  "needs_fork": boolean,
  "needs_ask": boolean,
  "rationale": "one sentence"
}`;

export async function runAnalyzer(opts: {
  model: LanguageModelV2;
  userMessage: string;
  sessionContext: string;
  trace: TraceWriter;
}): Promise<AnalyzerResult> {
  const { model, userMessage, sessionContext, trace } = opts;

  const userTurn = sessionContext
    ? `${sessionContext}\n\nUser: ${userMessage}`
    : `User: ${userMessage}`;

  trace.write({ type: 'analyzer_start', messageLen: userMessage.length });

  const { text } = await generateText({
    model: model as unknown as Parameters<typeof generateText>[0]['model'],
    system: ANALYZER_SYSTEM_PROMPT,
    prompt: userTurn,
  });

  let result: AnalyzerResult;
  try {
    result = JSON.parse(text.trim()) as AnalyzerResult;
  } catch {
    // Fallback if model returns fenced or malformed JSON
    const stripped = text
      .replace(/^```json\n?/m, '')
      .replace(/^```\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();
    result = JSON.parse(stripped) as AnalyzerResult;
  }

  trace.write({
    type: 'analyzer_result',
    difficulty: result.difficulty,
    skip_planner: result.skip_planner,
    estimated_tasks: result.estimated_tasks,
    needs_fork: result.needs_fork,
    needs_ask: result.needs_ask,
    rationale: result.rationale,
  });

  return result;
}
