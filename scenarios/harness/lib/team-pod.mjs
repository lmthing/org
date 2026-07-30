/**
 * TEAM pod client — the multi-member analogue of `pod.mjs#Pod`.
 *
 * A personal pod has one user and no authentication of its own: `Pod` just carries a bearer token
 * and talks to the chat origin. A TEAM pod is reached by every member, so every request must say
 * WHO is calling. That identity is four headers Envoy projects from the validated team-scoped JWT
 * (`x-user-id`, `x-user-email`, `x-team-id`, `x-lmthing-role` — see
 * `libs/cli/src/server/team-guard.ts#readCaller`), and the pod trusts them ABSOLUTELY, because the
 * only network path to a pod in production is through the edge, whose JWT filter overwrites any
 * same-named header a client sent.
 *
 * That is exactly what makes a local harness possible with no proxy: locally there is no Envoy, so
 * the harness simply sends those headers itself and the pod believes it — which is the same thing
 * production does, minus the JWT verification the edge owns. So `TeamPod` holds a **cast of
 * members** and every call is made AS one of them:
 *
 *   const pod = new TeamPod({ base: run.base, teamId: 'acme', members: [
 *     { name: 'ana', role: 'editor' }, { name: 'bo', role: 'editor' }, { name: 'vic', role: 'viewer' },
 *   ]});
 *   await pod.introduceAll();                      // every member appears in the directory
 *   const { channel } = await pod.createChannel('ana', 'launch');
 *   await pod.postMessage('bo', channel.id, 'hello');
 *   const denied = await pod.request('vic', 'POST', '/api/team/channels', { name: 'x' }, { raw: true });
 *   denied.status === 403                          // a viewer is genuinely refused a write
 *
 * A **viewer is a first-class member** here for that last line: read-only enforcement is a product
 * behaviour with its own allowlist (`team-guard.ts#VIEWER_ALLOWED`), and a harness that could only
 * model editors could never test it.
 *
 * `pod.as('ana')` returns the same surface with the member pre-bound, for code that reads better as
 * a person doing things: `ana.postMessage(channelId, 'hello')`.
 *
 * ── The socket ──────────────────────────────────────────────────────────────────────────────────
 * `/api/team/ws` carries the events that say what THING is doing (`thing_status`) and everything
 * anybody posted (`message`). It is guarded by the SAME identity headers (`guardWebSocket`), and
 * Node's global `WebSocket` cannot set request headers — so `TeamSocket` performs the upgrade by
 * hand over `node:http` and decodes RFC-6455 frames itself. That keeps the harness zero-dependency
 * (`ws` is not resolvable from this workspace package) and, more importantly, keeps the identity on
 * the socket: a DM's events are fanned out only to its participants, so an observer with the wrong
 * identity silently sees nothing.
 */
import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fetchResilient } from './pod.mjs';

/** Roles the pod understands (`team-guard.ts#TeamRole`). Anything else is rejected as no identity. */
export const TEAM_ROLES = Object.freeze(['viewer', 'editor']);

/** The identity headers Envoy injects, for one member. */
export function teamHeaders(member) {
  return {
    'x-user-id': member.userId,
    'x-user-email': member.email,
    'x-team-id': member.teamId,
    'x-lmthing-role': member.role,
  };
}

/**
 * The member-bound methods. `pod.as('ana').postMessage(ch, 'hi')` is exactly
 * `pod.postMessage('ana', ch, 'hi')` — one implementation, two spellings.
 */
const BOUND_METHODS = [
  'request',
  'introduce',
  'listChannels',
  'createChannel',
  'patchChannel',
  'listMessages',
  'threadMessages',
  'postMessage',
  'markRead',
  'createDm',
  'listCategories',
  'createCategory',
  'patchCategory',
  'deleteCategory',
  'directory',
  'profile',
  'setProfile',
  'socket',
];

export class TeamPod {
  /**
   * @param {object} o
   * @param {string} o.base                 the team pod origin (local: http://localhost:<port>)
   * @param {string} [o.teamId='team-scn']  the team every member belongs to (`x-team-id`)
   * @param {Array<{name?:string,userId?:string,email?:string,role?:string,handle?:string,displayName?:string}>} [o.members]
   *        the cast. `name` is the harness-local key you address them by; `userId`/`email` default
   *        to stable values derived from it, so a scenario names people, not opaque ids.
   * @param {boolean} [o.verbose=false]
   */
  constructor({ base, teamId = 'team-scn', members = [], verbose = false } = {}) {
    if (!base) throw new Error('TeamPod needs a base URL');
    this.base = base.replace(/\/$/, '');
    this.teamId = teamId;
    this.verbose = verbose;
    /** @type {Map<string, {name:string,userId:string,email:string,role:string,teamId:string,handle?:string,displayName?:string}>} */
    this.cast = new Map();
    for (const m of members) this.addMember(m);
    /** Sockets opened through this pod, so `closeSockets()` can reap them all. */
    this.sockets = new Set();
  }

  log(...a) {
    if (this.verbose) console.log('[team]', ...a);
  }

  /**
   * Add a member to the cast. Ids and emails are DERIVED from the name unless given, so a run is
   * reproducible and a log line names a person (`u-ana`, `ana@team.test`) instead of a UUID.
   */
  addMember({ name, userId, email, role = 'editor', handle, displayName } = {}) {
    const key = name ?? userId ?? email;
    if (!key) throw new Error('a team member needs a name (or a userId/email)');
    if (!TEAM_ROLES.includes(role)) {
      throw new Error(`unknown team role "${role}" — the pod accepts ${TEAM_ROLES.join('|')} and treats anything else as NO identity (401)`);
    }
    const member = {
      name: key,
      userId: userId ?? `u-${key}`,
      email: email ?? `${key}@team.test`,
      role,
      teamId: this.teamId,
      ...(handle ? { handle } : {}),
      ...(displayName ? { displayName } : {}),
    };
    this.cast.set(key, member);
    return member;
  }

  /** Every member, in cast order. */
  members() {
    return [...this.cast.values()];
  }

  /** Resolve a member by cast name, userId or email. Throws rather than sending a nameless request. */
  member(who) {
    if (who && typeof who === 'object' && who.userId) return who;
    const direct = this.cast.get(who);
    if (direct) return direct;
    const found = this.members().find((m) => m.userId === who || m.email === who);
    if (!found) {
      throw new Error(`no such team member: ${who} (cast: ${[...this.cast.keys()].join(', ') || 'empty'})`);
    }
    return found;
  }

  /** The same surface with `who` pre-bound. */
  as(who) {
    const member = this.member(who);
    const bound = { member, pod: this };
    for (const name of BOUND_METHODS) {
      bound[name] = (...args) => this[name](member, ...args);
    }
    return bound;
  }

  /**
   * One request, made as `who`.
   *
   * Mirrors `Pod#req`: throws on a non-2xx unless `{raw:true}`, which returns `{status, body}` —
   * the shape a viewer-refusal assertion needs (a 403 is the RESULT there, not a fault).
   */
  async request(who, method, path, body, { raw = false, headers = {} } = {}) {
    const member = this.member(who);
    const res = await fetchResilient(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...teamHeaders(member),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* html / raw */
    }
    this.log(`${member.name} ${method} ${path} → ${res.status}`);
    if (!res.ok && !raw) {
      const err = new Error(`[${member.name}/${member.role}] ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return raw ? { status: res.status, body: parsed } : parsed;
  }

  // ── the directory ───────────────────────────────────────────────────────────────────────────
  /** `GET /api/team/directory` — the `@` picker's whole payload: `{members, projects}`. */
  directory = (who) => this.request(who, 'GET', '/api/team/directory');
  /** `GET /api/team/profile` — the caller's own row. Also UPSERTS them into the directory. */
  profile = (who) => this.request(who, 'GET', '/api/team/profile');
  /** `PUT /api/team/profile {handle?, displayName?}` — viewer-allowed by design. */
  setProfile = (who, patch) => this.request(who, 'PUT', '/api/team/profile', patch);

  /**
   * Make a member exist in the directory under the name they should be addressed by.
   *
   * The roster fills itself from any identified request (`team-members.ts#touchMember`), but a
   * member with no HANDLE cannot be `@`-mentioned, and `resolveMentions` runs at POST time — so a
   * cast that never introduced itself produces messages that mention nobody.
   */
  async introduce(who) {
    const member = this.member(who);
    await this.profile(member);
    if (member.handle || member.displayName) {
      const { profile } = await this.setProfile(member, {
        ...(member.handle ? { handle: member.handle } : {}),
        ...(member.displayName ? { displayName: member.displayName } : {}),
      });
      return profile;
    }
    return (await this.profile(member)).profile;
  }

  /** Introduce the whole cast, in order (sequential: the directory is one JSON file). */
  async introduceAll() {
    const out = [];
    for (const m of this.members()) out.push(await this.introduce(m));
    return out;
  }

  // ── channels ────────────────────────────────────────────────────────────────────────────────
  /** `GET /api/team/channels` → `{channels, categories, unread}` (only what this member may see). */
  listChannels = (who) => this.request(who, 'GET', '/api/team/channels');
  /** `POST /api/team/channels {name, categoryId?}` → `{channel, created}`. Editor-only. */
  createChannel = (who, name, { categoryId } = {}) =>
    this.request(who, 'POST', '/api/team/channels', { name, ...(categoryId ? { categoryId } : {}) });
  /** `PATCH /api/team/channels/:id {name?, categoryId?, apps?}` → `{channel}`. Editor-only. */
  patchChannel = (who, channelId, patch) =>
    this.request(who, 'PATCH', `/api/team/channels/${channelId}`, patch);
  /** `POST /api/team/dms {userId}` → `{channel, created}`. Viewer-allowed; idempotent per pair. */
  createDm = (who, other) => this.request(who, 'POST', '/api/team/dms', { userId: this.member(other).userId });
  /** `POST /api/team/channels/:id/read` → `{ok}`. Viewer-allowed. */
  markRead = (who, channelId) => this.request(who, 'POST', `/api/team/channels/${channelId}/read`);

  // ── categories ──────────────────────────────────────────────────────────────────────────────
  listCategories = (who) => this.request(who, 'GET', '/api/team/categories');
  createCategory = (who, name) => this.request(who, 'POST', '/api/team/categories', { name });
  patchCategory = (who, categoryId, patch) =>
    this.request(who, 'PATCH', `/api/team/categories/${categoryId}`, patch);
  deleteCategory = (who, categoryId) => this.request(who, 'DELETE', `/api/team/categories/${categoryId}`);

  // ── messages ────────────────────────────────────────────────────────────────────────────────
  /** `GET /api/team/channels/:id/messages?limit&before` → `{messages, hasMore}` (oldest→newest). */
  listMessages(who, channelId, { limit, before } = {}) {
    const q = new URLSearchParams();
    if (limit) q.set('limit', String(limit));
    if (before) q.set('before', before);
    const qs = q.toString();
    return this.request(who, 'GET', `/api/team/channels/${channelId}/messages${qs ? `?${qs}` : ''}`);
  }

  /**
   * Just the messages of one thread, in order — the thread ROOT plus everything that carries its id.
   * `threadRootOf` (`team-channels.ts`) makes the opening message its own thread key, which is why
   * the root has no `threadId` of its own.
   */
  async threadMessages(who, channelId, threadId, { limit = 200 } = {}) {
    const { messages } = await this.listMessages(who, channelId, { limit });
    return (messages ?? []).filter((m) => m.id === threadId || m.threadId === threadId);
  }

  /**
   * `POST /api/team/channels/:id/messages {text, threadId?}` → `{message}` (201).
   *
   * Returns as soon as the member's OWN message is stored. If it addressed THING, the answer
   * arrives later on the socket — which is what `team-thread.mjs#ThreadSession` waits for.
   * Viewer-allowed: talking is the point of the surface.
   */
  postMessage = (who, channelId, text, { threadId } = {}) =>
    this.request(who, 'POST', `/api/team/channels/${channelId}/messages`, {
      text,
      ...(threadId ? { threadId } : {}),
    });

  // ── the socket ──────────────────────────────────────────────────────────────────────────────
  /** Open `/api/team/ws` as this member. Resolves once the upgrade completed. */
  async socket(who, { onEvent } = {}) {
    const member = this.member(who);
    const sock = new TeamSocket({ base: this.base, member, ...(onEvent ? { onEvent } : {}), verbose: this.verbose });
    await sock.open();
    this.sockets.add(sock);
    sock.onClose(() => this.sockets.delete(sock));
    return sock;
  }

  /** Close every socket this pod opened (teardown). */
  closeSockets() {
    for (const s of [...this.sockets]) s.close();
    this.sockets.clear();
  }
}

// ── a minimal, zero-dep WebSocket client that can send REQUEST HEADERS ─────────────────────────
//
// Node's global `WebSocket` (undici) has no way to set headers on the upgrade, and `ws` is not
// resolvable from this workspace package. The team socket's whole authorization is headers
// (`guardWebSocket` → `readCaller`), so we do the handshake over `node:http` and decode frames
// ourselves. We only ever RECEIVE data frames (the one client frame the server accepts is
// `typing`), so this stays small: mask on the way out, unmask on the way in, reassemble
// continuations, answer pings.

const OPCODE = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class TeamSocket {
  /**
   * @param {object} o
   * @param {string} o.base                  pod origin
   * @param {object} o.member                the identity to open it with (decides DM audience)
   * @param {(event:object)=>void} [o.onEvent]
   */
  constructor({ base, member, onEvent, verbose = false }) {
    this.base = base;
    this.member = member;
    this.verbose = verbose;
    /** Every frame the server sent, in order — the driver's source of truth. */
    this.events = [];
    this.handlers = onEvent ? [onEvent] : [];
    this.closeHandlers = [];
    this.closed = false;
    this.socket = null;
    this._buf = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOpcode = null;
  }

  /** Subscribe to server events. Returns an unsubscribe. */
  on(handler) {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  onClose(handler) {
    this.closeHandlers.push(handler);
  }

  open() {
    const url = new URL(`${this.base}/api/team/ws`);
    const key = randomBytes(16).toString('base64');
    const expectAccept = createHash('sha1').update(key + WS_GUID).digest('base64');
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        ...teamHeaders(this.member),
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    return new Promise((resolve, reject) => {
      // The guard refuses BEFORE the upgrade: it writes a bare status line and destroys the
      // socket, which arrives here as an ordinary response. Surface the status — "a viewer may
      // not open a terminal" is a fact a scenario asserts, not a transport error to swallow.
      req.on('response', (res) => {
        res.resume();
        const err = new Error(
          `team ws upgrade refused for ${this.member.name} (${this.member.role}) → ${res.statusCode}`,
        );
        err.status = res.statusCode;
        reject(err);
      });
      req.on('upgrade', (res, socket, head) => {
        const accept = res.headers['sec-websocket-accept'];
        if (accept !== expectAccept) {
          socket.destroy();
          reject(new Error(`team ws handshake mismatch (got ${accept ?? 'no accept header'})`));
          return;
        }
        this.socket = socket;
        socket.on('data', (chunk) => this.#feed(chunk));
        socket.on('close', () => this.#closed());
        socket.on('error', () => this.#closed());
        if (head?.length) this.#feed(head);
        resolve(this);
      });
      req.on('error', reject);
      req.end();
    });
  }

  #closed() {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {
        /* teardown */
      }
    }
  }

  #feed(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    for (;;) {
      const frame = this.#readFrame();
      if (!frame) return;
      this.#handleFrame(frame);
    }
  }

  /** Decode one frame off the head of the buffer, or null if it is not all here yet. */
  #readFrame() {
    const buf = this._buf;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return null;
      mask = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return null;
    const payload = Buffer.from(buf.subarray(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    this._buf = buf.subarray(off + len);
    return { fin, opcode, payload };
  }

  #handleFrame({ fin, opcode, payload }) {
    if (opcode === OPCODE.PING) {
      this.#send(OPCODE.PONG, payload);
      return;
    }
    if (opcode === OPCODE.PONG) return;
    if (opcode === OPCODE.CLOSE) {
      try {
        this.socket?.end();
      } catch {
        /* already gone */
      }
      this.#closed();
      return;
    }
    if (opcode === OPCODE.CONT) {
      this._fragments.push(payload);
      if (!fin) return;
      const whole = Buffer.concat(this._fragments);
      const first = this._fragmentOpcode;
      this._fragments = [];
      this._fragmentOpcode = null;
      if (first === OPCODE.TEXT) this.#deliver(whole.toString('utf8'));
      return;
    }
    if (!fin) {
      this._fragmentOpcode = opcode;
      this._fragments = [payload];
      return;
    }
    if (opcode === OPCODE.TEXT) this.#deliver(payload.toString('utf8'));
  }

  #deliver(text) {
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return; // the server only ever sends JSON; anything else is not ours to interpret
    }
    this.events.push(event);
    if (this.verbose) console.log('[team ws]', this.member.name, JSON.stringify(event).slice(0, 200));
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        console.error('[team ws] handler threw', err);
      }
    }
  }

  /** Write one frame. Client→server frames MUST be masked (RFC 6455 §5.3). */
  #send(opcode, payload) {
    if (!this.socket || this.closed) return;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const head = [];
    head.push(0x80 | opcode);
    if (body.length < 126) head.push(0x80 | body.length);
    else if (body.length < 65536) head.push(0x80 | 126, body.length >> 8, body.length & 0xff);
    else {
      head.push(0x80 | 127);
      const big = Buffer.alloc(8);
      big.writeBigUInt64BE(BigInt(body.length));
      for (const b of big) head.push(b);
    }
    const mask = randomBytes(4);
    const masked = Buffer.from(body);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    try {
      this.socket.write(Buffer.concat([Buffer.from(head), mask, masked]));
    } catch {
      this.#closed();
    }
  }

  /** The one frame a client may push: "I am typing in this channel." */
  typing(channelId) {
    this.#send(OPCODE.TEXT, JSON.stringify({ type: 'typing', channelId }));
  }

  close() {
    if (this.closed) return;
    this.#send(OPCODE.CLOSE, Buffer.alloc(0));
    try {
      this.socket?.destroy();
    } catch {
      /* already gone */
    }
    this.#closed();
  }
}
