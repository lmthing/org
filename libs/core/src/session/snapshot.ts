import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from '../context/history.js';

export interface Snapshot {
  sessionId: string;
  agentSlug: string;
  spaceDir: string;
  history: Message[];
  scope: Record<string, unknown>; // JSON-serializable VM scope vars
  createdAt: number;
}

export async function saveSnapshot(dir: string, snapshot: Snapshot): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'snapshot.json');
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function loadSnapshot(dir: string): Promise<Snapshot | null> {
  const filePath = join(dir, 'snapshot.json');
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as Snapshot;
  } catch {
    return null;
  }
}
