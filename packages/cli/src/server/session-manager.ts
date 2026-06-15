import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Session, saveSnapshot } from '@lmthing/core';
import type { StreamOpts, StreamSession } from '@lmthing/core';
import { WebRenderHost } from '../rpc/server.js';
import { TraceHub } from '../rpc/trace-hub.js';

export type SessionStatus = 'idle' | 'running' | 'error';

/** One live multi-session entry: the Session plus its OWN renderHost + hub so
 *  events never cross sessions. */
export interface SessionEntry {
  sessionId: string;
  session: Session;
  renderHost: WebRenderHost;
  hub: TraceHub;
  spaceDir: string;
  agentSlug: string;
  lastActivity: number;
  started: boolean;
  status: SessionStatus;
}

/** Lightweight metadata for listSessions() — never exposes the Session object. */
export interface SessionMeta {
  sessionId: string;
  spaceDir: string;
  agentSlug: string;
  lastActivity: number;
  started: boolean;
  status: SessionStatus;
}

/** Parameters for spinning up one session's wiring (mirrors bin.ts web branch). */
export interface BuildSessionArgs {
  spaceDir: string;
  agentSlug: string;
  model?: string;
  budget?: {
    maxEpisodes?: number;
    maxToolCalls?: number;
    maxForkDepth?: number;
    maxWallClockMs?: number;
  };
  renderHost: WebRenderHost;
}

/** Encapsulates the bin.ts wiring: construct a Session bound to the chosen
 *  streamFn. The manager owns the entry's hub and subscribes it to the returned
 *  session's tracer, so each session's events stay scoped to its own hub. */
export type BuildSession = (args: BuildSessionArgs) => Session;

export interface SessionManagerOpts {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  defaultSpaceDir?: string;
  maxSessions?: number;
  snapshotsDir?: string;
  idleTtlMs?: number;
  /** Encapsulates the bin.ts wiring (construct Session bound to a streamFn). The
   *  manager pairs each session with its OWN WebRenderHost + TraceHub. When
   *  omitted, a default builder using `streamFn` is used. */
  buildSession?: BuildSession;
}

/**
 * Owns a pool of independent agent sessions. Each session gets its OWN
 * WebRenderHost + TraceHub so display/ask/trace events never cross sessions.
 */
export class SessionManager {
  private sessions: Map<string, SessionEntry> = new Map();
  private streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  private defaultSpaceDir?: string;
  readonly maxSessions: number;
  readonly snapshotsDir: string;
  readonly idleTtlMs: number;
  private buildSessionFn: BuildSession;
  private reaper: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SessionManagerOpts) {
    this.streamFn = opts.streamFn;
    this.defaultSpaceDir = opts.defaultSpaceDir;
    this.maxSessions = opts.maxSessions ?? (Number(process.env['MAX_SESSIONS']) || 8);
    this.snapshotsDir = opts.snapshotsDir ?? process.env['SNAPSHOTS_DIR'] ?? '/data/snapshots';
    this.idleTtlMs = opts.idleTtlMs ?? Number(process.env['IDLE_TTL_MINUTES'] ?? 15) * 60000;
    this.buildSessionFn = opts.buildSession ?? this.defaultBuildSession.bind(this);
  }

  /** Default session builder — constructs a Session bound to `streamFn`. */
  private defaultBuildSession(args: BuildSessionArgs): Session {
    return new Session(
      {
        spaceDir: args.spaceDir,
        agentSlug: args.agentSlug,
        modelAlias: args.model ?? 'default',
        renderHost: args.renderHost,
        budget: args.budget,
        maxHistoryTurns: 20,
      },
      { streamFn: this.streamFn },
    );
  }

  createSession(opts: {
    spaceDir?: string;
    agentSlug?: string;
    model?: string;
    budget?: BuildSessionArgs['budget'];
  }): { sessionId: string } {
    if (this.sessions.size >= this.maxSessions) {
      const msg = `max sessions reached (${this.maxSessions})`;
      console.warn(`[session-manager] ${msg}`);
      throw new Error(msg);
    }

    const spaceDir = opts.spaceDir ?? this.defaultSpaceDir;
    if (!spaceDir) {
      throw new Error('no spaceDir provided and no defaultSpaceDir configured');
    }
    const agentSlug = opts.agentSlug ?? 'default';

    const sessionId = randomUUID();
    const renderHost = new WebRenderHost();
    const hub = new TraceHub();
    const session = this.buildSessionFn({
      spaceDir,
      agentSlug,
      model: opts.model,
      budget: opts.budget,
      renderHost,
    });

    // Subscribe this session's tracer to its OWN hub so trace events stay scoped.
    if (typeof session.getTracer === 'function') {
      session.getTracer().subscribe((e) => hub.push(e));
    }

    const entry: SessionEntry = {
      sessionId,
      session,
      renderHost,
      hub,
      spaceDir,
      agentSlug,
      lastActivity: Date.now(),
      started: false,
      status: 'idle',
    };
    this.sessions.set(sessionId, entry);
    return { sessionId };
  }

  getSession(id: string): SessionEntry | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionMeta[] {
    return [...this.sessions.values()].map((e) => ({
      sessionId: e.sessionId,
      spaceDir: e.spaceDir,
      agentSlug: e.agentSlug,
      lastActivity: e.lastActivity,
      started: e.started,
      status: e.status,
    }));
  }

  /** Send a user message: start() on first message, continue() after. Surfaces
   *  errors via the entry's renderHost like serve.ts does. */
  sendMessage(id: string, content: string): void {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`unknown session "${id}"`);

    const run = entry.started
      ? entry.session.continue(content)
      : entry.session.start(content);
    entry.started = true;
    entry.status = 'running';
    entry.lastActivity = Date.now();
    run
      .then(() => {
        entry.status = 'idle';
        entry.lastActivity = Date.now();
        entry.renderHost.emit({ type: 'done' });
      })
      .catch((err: unknown) => {
        entry.status = 'error';
        entry.lastActivity = Date.now();
        entry.renderHost.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }

  /** Snapshot best-effort, dispose the VM, then drop from the map. */
  async disposeSession(id: string): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    try {
      await saveSnapshot(join(this.snapshotsDir, id), {
        sessionId: id,
        agentSlug: entry.agentSlug,
        spaceDir: entry.spaceDir,
        history: [],
        scope: {},
        createdAt: Date.now(),
      });
    } catch {
      /* best-effort */
    }
    try {
      entry.session.dispose();
    } catch {
      /* best-effort */
    }
    this.sessions.delete(id);
    return true;
  }

  /** Begin periodically reaping idle sessions. */
  startReaper(intervalMs = 60000): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.sessions) {
        if (now - entry.lastActivity > this.idleTtlMs) {
          console.warn(`[session-manager] reaping idle session ${id}`);
          void this.disposeSession(id);
        }
      }
    }, intervalMs);
    // Don't keep the process alive solely for the reaper.
    this.reaper.unref?.();
  }

  stopReaper(): void {
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }
}
