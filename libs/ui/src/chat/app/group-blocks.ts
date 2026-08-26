import type { ConvoBlock } from '../store/model';

/**
 * A rendered turn: a single user message, or a run of consecutive non-user blocks (the assistant's
 * displays / asks / errors) collapsed into one assistant turn with the set of node ids that
 * contributed to it.
 */
export type MessageGroup =
  | { type: 'user'; block: ConvoBlock }
  | { type: 'assistant'; blocks: ConvoBlock[]; nodeIds: string[] };

/**
 * Group a flat `ConvoBlock[]` transcript into user / assistant turns.
 *
 * Pure and store-free on purpose: both the full `/chat` transcript (`ChatView`) and the decoupled
 * embedded dock (`ReplChatView`) render from the same `model.blocks` shape, so they share this one
 * grouping rather than each re-deriving it.
 */
export function groupBlocks(blocks: ConvoBlock[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: ConvoBlock[] = [];
  let nodeIds: string[] = [];

  const flush = () => {
    if (current.length) {
      groups.push({ type: 'assistant', blocks: current, nodeIds });
      current = [];
      nodeIds = [];
    }
  };

  for (const b of blocks) {
    if (b.type === 'user') {
      flush();
      groups.push({ type: 'user', block: b });
    } else {
      current.push(b);
      if (b.nodeId && !nodeIds.includes(b.nodeId)) nodeIds.push(b.nodeId);
    }
  }
  flush();
  return groups;
}
