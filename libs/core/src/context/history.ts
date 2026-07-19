import type { MediaPart } from '../eval/stream-types.js';

export type MessageRole = 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
  /** Multimodal attachments (images/files) carried by this user message. */
  attachments?: MediaPart[];
  blockType?: 'normal' | 'variables' | 'error' | 'system';
}

export class MessageHistory {
  messages: Message[] = [];

  append(msg: Message): void {
    this.messages.push(msg);
  }

  getPromptMessages(): Array<{ role: MessageRole; content: string; attachments?: MediaPart[] }> {
    return this.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.attachments && m.attachments.length ? { attachments: m.attachments } : {}),
    }));
  }

  /**
   * Total character count across every message's content — a cheap proxy for the
   * concatenated prompt size. Used to trigger MID-turn compaction
   * (`Session.maybeCompactHistoryBySize`) before a long single turn's growing history can
   * overflow V8's max string length (the runaway-turn "Invalid string length" crash). It
   * ignores attachments and the system block, so it is a lower bound — which is the safe
   * direction for a size gate.
   */
  totalChars(): number {
    let total = 0;
    for (const m of this.messages) total += m.content.length;
    return total;
  }

  /**
   * Collapse old messages into a summary, keeping the last `keepLast` messages verbatim.
   */
  summarize(summary: string, keepLast: number): void {
    if (this.messages.length <= keepLast) return;

    const tail = this.messages.slice(-keepLast);
    const summaryMsg: Message = {
      role: 'user',
      content: `[CONTEXT SUMMARY]\n${summary}`,
      blockType: 'system',
    };

    this.messages = [summaryMsg, ...tail];
  }
}
