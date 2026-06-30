import type { Message } from './history.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';

export interface SummarizeOpts {
  messages: Message[];
  keepLast: number; // number of recent messages to keep verbatim
  streamFn?: (opts: StreamOpts) => Promise<StreamSession>; // optional LLM summarizer
}

const SUMMARIZE_SYSTEM = `You are a context summarizer. Given a conversation history, produce a concise summary of the key facts, variables, and outcomes. Focus on: variable values resolved, user decisions made, errors encountered and recovered from. Be concise but complete.`;

/**
 * Summarize old message history. Uses LLM if streamFn is provided,
 * otherwise does a deterministic digest of VARIABLES blocks.
 */
export async function summarizeHistory(opts: SummarizeOpts): Promise<string> {
  const { messages, keepLast, streamFn } = opts;

  const toSummarize = messages.slice(0, -keepLast);

  if (toSummarize.length === 0) {
    return '';
  }

  if (streamFn) {
    // LLM-based summarization
    const historyText = toSummarize
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const stream = await streamFn({
      system: SUMMARIZE_SYSTEM,
      messages: [{ role: 'user', content: `Summarize this conversation history:\n\n${historyText}` }],
    });

    let summary = '';
    for await (const chunk of stream.textStream) {
      summary += chunk;
    }

    return summary.trim();
  }

  // Deterministic digest: preserve the original task(s) + extract resolved
  // variables and errors from the collapsed history. Keeping the task text is
  // what lets the model stay on-intent after old turns are summarized away.
  const lines: string[] = [];

  for (const msg of toSummarize) {
    if (msg.role === 'user' && msg.blockType === 'normal') {
      const task = msg.content.replace(/^[\s\S]*?Task:\s*/m, '').trim().split('\n')[0] ?? '';
      if (task) lines.push(`task: ${task.slice(0, 300)}`);
    } else if (msg.blockType === 'variables' && msg.content.startsWith('VARIABLES')) {
      // Keep only the resolved VARIABLES values — stop at the SCOPE / ALREADY
      // EXECUTED sub-sections (those would balloon the summary).
      for (const line of msg.content.split('\n').slice(1)) {
        const t = line.trim();
        if (t.startsWith('SCOPE') || t.startsWith('ALREADY EXECUTED')) break;
        if (t) lines.push(`var: ${t}`);
      }
    } else if (msg.blockType === 'error') {
      lines.push(`error: ${msg.content.split('\n')[0] ?? ''}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : `[${toSummarize.length} messages summarized]`;
}
