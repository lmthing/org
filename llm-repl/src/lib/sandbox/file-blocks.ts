/**
 * Four-backtick file block interceptor.
 * Scans raw LLM output for ````path and ````diff path blocks before TypeScript parsing.
 */
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { TraceWriter } from './trace.js';

export interface FileBlockResult {
  type: 'write' | 'diff';
  path: string;
  content: string;
}

export interface FileBlockScanResult {
  blocks: FileBlockResult[];
  remaining: string;
}

const FOUR_BACKTICK = '````';

/**
 * Scan input text for four-backtick file blocks and extract them.
 *
 * Write block:  ````path/to/file\n<content>\n````
 * Diff block:   ````diff path/to/file\n<content>\n````
 */
export function scanFileBlocks(text: string): FileBlockScanResult {
  const blocks: FileBlockResult[] = [];
  let remaining = text;
  let result = '';

  while (true) {
    const openIdx = remaining.indexOf(FOUR_BACKTICK);
    if (openIdx === -1) {
      result += remaining;
      break;
    }

    // Everything before the opening fence
    result += remaining.slice(0, openIdx);
    const afterOpen = remaining.slice(openIdx + FOUR_BACKTICK.length);

    // Find newline after the fence header
    const nlIdx = afterOpen.indexOf('\n');
    if (nlIdx === -1) {
      // No newline — unterminated, treat rest as remaining
      result += remaining.slice(openIdx);
      break;
    }

    const header = afterOpen.slice(0, nlIdx).trim();
    const afterHeader = afterOpen.slice(nlIdx + 1);

    // Find closing ````
    const closeIdx = afterHeader.indexOf('\n' + FOUR_BACKTICK);
    if (closeIdx === -1) {
      // Unterminated block — leave as remaining
      result += remaining.slice(openIdx);
      break;
    }

    const content = afterHeader.slice(0, closeIdx);
    // Skip past closing fence and its trailing newline if present
    const afterClose = afterHeader.slice(closeIdx + 1 + FOUR_BACKTICK.length);
    remaining = afterClose.startsWith('\n') ? afterClose.slice(1) : afterClose;

    // Parse header: "diff path/to/file" or "path/to/file"
    if (header.startsWith('diff ')) {
      const filePath = header.slice(5).trim();
      if (filePath) {
        blocks.push({ type: 'diff', path: filePath, content });
      } else {
        // Bad header — discard
      }
    } else {
      const filePath = header;
      if (filePath) {
        blocks.push({ type: 'write', path: filePath, content });
      }
    }
  }

  return { blocks, remaining: result };
}

// ── Unified diff helpers (adapted from repl/src/stream/file-block-applier.ts) ──

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: Array<{ op: ' ' | '-' | '+'; text: string }>;
}

function parseHunks(diffContent: string): Hunk[] {
  const lines = diffContent.split('\n');
  const hunks: Hunk[] = [];
  let i = 0;

  while (i < lines.length && !lines[i].startsWith('@@')) i++;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }

    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      i++;
      continue;
    }

    const oldStart = parseInt(match[1], 10);
    const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

    i++;
    const hunkLines: Hunk['lines'] = [];

    while (i < lines.length && !lines[i].startsWith('@@')) {
      const l = lines[i];
      if (l.startsWith('-')) {
        hunkLines.push({ op: '-', text: l.slice(1) });
      } else if (l.startsWith('+')) {
        hunkLines.push({ op: '+', text: l.slice(1) });
      } else if (l.startsWith(' ')) {
        hunkLines.push({ op: ' ', text: l.slice(1) });
      } else if (l.startsWith('\\')) {
        // "\ No newline at end of file" — skip
      } else if (
        l === '' ||
        l.startsWith('diff ') ||
        l.startsWith('---') ||
        l.startsWith('+++')
      ) {
        break;
      }
      i++;
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  return hunks;
}

function applyHunksToContent(
  fileContent: string,
  hunks: Hunk[],
): { ok: true; content: string } | { ok: false; error: string } {
  const hadTrailingNewline = fileContent.endsWith('\n');
  const fileLines = fileContent.split('\n');
  if (hadTrailingNewline && fileLines[fileLines.length - 1] === '') {
    fileLines.pop();
  }

  const result = [...fileLines];
  let offset = 0;

  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1 + offset;

    const expectedOldLines = hunk.lines
      .filter((l) => l.op === ' ' || l.op === '-')
      .map((l) => l.text);

    for (let j = 0; j < expectedOldLines.length; j++) {
      const fileIdx = startIdx + j;
      const fileLine = result[fileIdx];
      if (fileLine !== expectedOldLines[j]) {
        return {
          ok: false,
          error:
            `Hunk @@ -${hunk.oldStart},${hunk.oldCount} @@: context mismatch at line ${hunk.oldStart + j}.` +
            ` Expected ${JSON.stringify(expectedOldLines[j])}, got ${fileLine === undefined ? '<EOF>' : JSON.stringify(fileLine)}`,
        };
      }
    }

    const newLines = hunk.lines
      .filter((l) => l.op === ' ' || l.op === '+')
      .map((l) => l.text);

    result.splice(startIdx, expectedOldLines.length, ...newLines);
    offset += newLines.length - expectedOldLines.length;
  }

  const content = result.join('\n') + (hadTrailingNewline ? '\n' : '');
  return { ok: true, content };
}

// ── Path safety ──

function isSafePath(filePath: string): boolean {
  if (!filePath) return false;
  // No absolute paths
  if (nodePath.isAbsolute(filePath)) return false;
  // No .. traversal
  const normalized = nodePath.normalize(filePath);
  if (normalized.startsWith('..')) return false;
  const parts = filePath.split(/[/\\]/);
  if (parts.includes('..')) return false;
  return true;
}

// ── Public apply API ──

export async function applyFileBlock(
  block: FileBlockResult,
  sessionFilesDir: string,
  readLedger: Set<string>,
  traceWriter: TraceWriter,
): Promise<string | null> {
  if (!isSafePath(block.path)) {
    return `Path traversal blocked: ${block.path}`;
  }

  const resolved = nodePath.resolve(sessionFilesDir, block.path);

  if (block.type === 'write') {
    try {
      await nodeFs.mkdir(nodePath.dirname(resolved), { recursive: true });
      await nodeFs.writeFile(resolved, block.content, 'utf-8');
      readLedger.add(block.path);
      traceWriter.write({ type: 'file_write', path: block.path });
      return null;
    } catch (err: unknown) {
      return `Failed to write ${block.path}: ${(err as Error).message}`;
    }
  }

  // diff block
  if (!readLedger.has(block.path)) {
    traceWriter.write({ type: 'file_diff_no_read', path: block.path });
    return `File '${block.path}' has not been read this session. Call readFile('${block.path}') before patching.`;
  }

  let existing: string;
  try {
    existing = await nodeFs.readFile(resolved, 'utf-8');
  } catch {
    return `Cannot read '${block.path}': file does not exist or is not readable.`;
  }

  const hunks = parseHunks(block.content);
  if (hunks.length === 0) {
    return `No valid hunks found in diff for '${block.path}'.`;
  }

  const result = applyHunksToContent(existing, hunks);
  if (!result.ok) {
    return result.error;
  }

  try {
    await nodeFs.writeFile(resolved, result.content, 'utf-8');
    traceWriter.write({ type: 'file_diff', path: block.path });
    return null;
  } catch (err: unknown) {
    return `Failed to write patched ${block.path}: ${(err as Error).message}`;
  }
}
