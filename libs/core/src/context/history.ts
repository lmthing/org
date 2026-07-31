import type { MediaPart } from '../eval/stream-types.js';
import { formatAlreadyExecuted } from './variables.js';

export type MessageRole = 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
  /** Multimodal attachments (images/files) carried by this user message. */
  attachments?: MediaPart[];
  blockType?: 'normal' | 'variables' | 'error' | 'system';
  /** Raw accumulated-context snapshot for a 'variables' block. NOT part of
   *  `content`: the prompt builder renders it (bounded) onto the LATEST
   *  variables block only — every earlier block's echo is superseded by the
   *  next one, so re-sending each copy every request made history quadratic
   *  in program size. Stored raw so the newest snapshot always wins. */
  alreadyExecuted?: string;
}

export class MessageHistory {
  messages: Message[] = [];

  append(msg: Message): void {
    this.messages.push(msg);
  }

  getPromptMessages(): Array<{ role: MessageRole; content: string; attachments?: MediaPart[] }> {
    // Only the LAST variables block carrying a context snapshot renders its
    // ALREADY-EXECUTED echo (bounded); earlier snapshots are dead weight.
    let lastEchoIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.blockType === 'variables' && m.alreadyExecuted) {
        lastEchoIdx = i;
        break;
      }
    }
    return this.messages.map((m, i) => ({
      role: m.role,
      content:
        i === lastEchoIdx && m.alreadyExecuted
          ? `${m.content}\n\n${formatAlreadyExecuted(m.alreadyExecuted)}`
          : m.content,
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
