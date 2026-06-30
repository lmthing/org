export type MessageRole = 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
  blockType?: 'normal' | 'variables' | 'error' | 'system';
}

export class MessageHistory {
  messages: Message[] = [];

  append(msg: Message): void {
    this.messages.push(msg);
  }

  getPromptMessages(): Array<{ role: MessageRole; content: string }> {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
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
