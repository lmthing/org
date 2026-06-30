/**
 * TerminalManager — multiplexes PTY shells over a single WS control socket.
 *
 * Each `open(termId, …)` spawns a real shell via node-pty and pipes its output
 * back through the supplied `onData` callback. The server wires that callback to
 * a `{ type: 'terminal.data', sessionId, data }` frame, mirroring the client
 * protocol in `computer/src/lib/runtime/ws-protocol.ts`.
 *
 * node-pty is a native addon and may fail to load under non-Node runtimes (e.g.
 * Bun). The import is therefore lazy + guarded: if it cannot be loaded, `open`
 * throws a descriptive error which the caller surfaces as an `error` event,
 * leaving the rest of the server functional. The PTY stays behind this seam so
 * swapping to a maintained fork (e.g. @homebridge/node-pty-prebuilt-multiarch)
 * is a one-line change here.
 */

// node-pty's types — imported as types only so the build never hard-depends on
// the native addon being present at type-check time.
import type { IPty } from 'node-pty';

type PtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string | undefined>;
    },
  ) => IPty;
};

let ptyModule: PtyModule | null = null;
let ptyLoadError: Error | null = null;

/** Lazily load node-pty once; cache the module or the load error. */
async function loadPty(): Promise<PtyModule> {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) throw ptyLoadError;
  try {
    // Dynamic import so a missing/incompatible native addon doesn't break startup.
    const mod = (await import('node-pty')) as unknown as PtyModule;
    ptyModule = mod;
    return mod;
  } catch (err) {
    ptyLoadError = new Error(
      `node-pty not available — terminal support requires a Node.js runtime with the native addon built (${err instanceof Error ? err.message : String(err)})`,
    );
    throw ptyLoadError;
  }
}

export class TerminalManager {
  private ptys: Map<string, IPty> = new Map();

  /**
   * Spawn a shell PTY for `termId`, cwd = `cwd`. Pipes PTY output to `onData`.
   * Throws if node-pty is unavailable or `termId` is already open.
   */
  async open(termId: string, cwd: string, onData: (data: string) => void, command?: string): Promise<void> {
    if (this.ptys.has(termId)) return; // already open — idempotent
    const pty = await loadPty();
    const shell = process.env['SHELL'] ?? 'bash';
    const proc = command
      ? pty.spawn('sh', ['-c', command], {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd,
          env: process.env,
        })
      : pty.spawn(shell, [], {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd,
          env: process.env,
        });
    proc.onData((data) => onData(data));
    this.ptys.set(termId, proc);
  }

  /** Write input bytes to the PTY for `termId` (no-op if unknown). */
  input(termId: string, data: string): void {
    this.ptys.get(termId)?.write(data);
  }

  /** Resize the PTY for `termId` (no-op if unknown). */
  resize(termId: string, cols: number, rows: number): void {
    const proc = this.ptys.get(termId);
    if (!proc) return;
    try {
      proc.resize(cols, rows);
    } catch {
      /* invalid dimensions — ignore */
    }
  }

  /** Kill + drop the PTY for `termId` (no-op if unknown). */
  close(termId: string): void {
    const proc = this.ptys.get(termId);
    if (!proc) return;
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
    this.ptys.delete(termId);
  }

  /** Kill all PTYs — call on socket close. */
  closeAll(): void {
    for (const termId of [...this.ptys.keys()]) this.close(termId);
  }
}
