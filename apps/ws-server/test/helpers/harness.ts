import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import type { RoomRole } from '@wb/shared';
import { RoomProvider, type SocketFactory, type SocketLike } from '@wb/shared/client';
import { createSupabaseJwtVerifier } from '@wb/shared/server';
import { SignJWT } from 'jose';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { WebSocket } from 'ws';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { RoleStore, SnapshotStore, StoredSnapshot } from '../../src/persistence/stores';
import type { Bus, RoomHandlers } from '../../src/redis/bus';
import { createWsServer, type WsServer, type WsServerDeps } from '../../src/server';

export const JWT_SECRET = 'super-secret-test-jwt-secret-at-least-32-bytes-long';
export const SUPABASE_URL = 'http://localhost:54321';
export const ORIGIN = 'http://localhost:3000';
export const silentLog = pino({ level: 'silent' });

export const verifyJwt = createSupabaseJwtVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: JWT_SECRET });

export function signToken(userId: string, expiresIn = '1h', secret = JWT_SECRET): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

export function until(check: () => boolean, timeoutMs = 5000, label = 'condition'): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) resolve();
      else if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${label}`));
      else setTimeout(tick, 2);
    };
    tick();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MemoryRoleStore implements RoleStore {
  readonly roles = new Map<string, RoomRole>();
  /** Delay applied to single lookups, used to widen the handshake race. */
  delayMs = 0;

  private key(roomId: string, userId: string): string {
    return `${roomId}:${userId}`;
  }

  set(roomId: string, userId: string, role: RoomRole | null): void {
    if (role) this.roles.set(this.key(roomId, userId), role);
    else this.roles.delete(this.key(roomId, userId));
  }

  async resolveRole(roomId: string, userId: string): Promise<RoomRole | null> {
    const value = this.roles.get(this.key(roomId, userId)) ?? null;
    if (this.delayMs > 0) await sleep(this.delayMs);
    return value;
  }

  async resolveRoles(roomId: string, userIds: string[]): Promise<Map<string, RoomRole>> {
    const result = new Map<string, RoomRole>();
    for (const userId of userIds) {
      const role = this.roles.get(this.key(roomId, userId));
      if (role) result.set(userId, role);
    }
    return result;
  }
}

export class MemorySnapshotStore implements SnapshotStore {
  private readonly rows = new Map<string, StoredSnapshot>();
  writes = 0;
  activeSaves = 0;
  maxConcurrentSaves = 0;
  saveDelayMs = 0;

  createRoom(roomId: string): void {
    this.rows.set(roomId, { bytes: null, version: 1 });
  }

  deleteRoom(roomId: string): void {
    this.rows.delete(roomId);
  }

  stored(roomId: string): Uint8Array | null {
    return this.rows.get(roomId)?.bytes ?? null;
  }

  async load(roomId: string): Promise<StoredSnapshot | null> {
    const row = this.rows.get(roomId);
    return row ? { ...row } : null;
  }

  async readVersion(roomId: string): Promise<number | null> {
    return this.rows.get(roomId)?.version ?? null;
  }

  async save(roomId: string, bytes: Uint8Array, expectedVersion: number): Promise<number | null> {
    this.activeSaves += 1;
    this.maxConcurrentSaves = Math.max(this.maxConcurrentSaves, this.activeSaves);
    if (this.saveDelayMs > 0) await sleep(this.saveDelayMs);
    this.activeSaves -= 1;
    const row = this.rows.get(roomId);
    if (!row || row.version !== expectedVersion) return null;
    this.writes += 1;
    row.bytes = bytes;
    row.version += 1;
    return row.version;
  }
}

/** A shared in-process stand-in for Redis, for tests that are not about Redis itself. */
export class MemoryHub {
  readonly rooms = new Map<string, Set<RoomHandlers>>();
  readonly locks = new Map<string, string>();
  readonly kicked = new Set<string>();
  /** What each instance last reported, as `roomId|instanceId` to a user count. */
  readonly presence = new Map<string, number>();

  bus(): Bus {
    const mine = new Map<string, RoomHandlers>();
    return {
      subscribeRoom: async (roomId, handlers) => {
        mine.set(roomId, handlers);
        const set = this.rooms.get(roomId) ?? new Set();
        set.add(handlers);
        this.rooms.set(roomId, set);
      },
      unsubscribeRoom: async (roomId) => {
        const handlers = mine.get(roomId);
        if (handlers) this.rooms.get(roomId)?.delete(handlers);
        mine.delete(roomId);
      },
      publishSync: async (roomId, frame) => {
        const set = this.rooms.get(roomId) ?? new Set<RoomHandlers>();
        for (const handlers of set) setImmediate(() => handlers.onSync(frame));
        return set.size;
      },
      onReconnect: () => undefined,
      acquireLock: async (key) => {
        if (this.locks.has(key)) return null;
        const token = randomUUID();
        this.locks.set(key, token);
        return token;
      },
      releaseLock: async (key, token) => {
        if (this.locks.get(key) === token) this.locks.delete(key);
      },
      isKicked: async (roomId, userId) => this.kicked.has(`${roomId}:${userId}`),
      setPresence: async (roomId, instanceId, users) => {
        if (users <= 0) this.presence.delete(`${roomId}|${instanceId}`);
        else this.presence.set(`${roomId}|${instanceId}`, users);
      },
      close: async () => undefined,
    };
  }

  control(roomId: string, event: unknown): void {
    for (const handlers of this.rooms.get(roomId) ?? []) handlers.onControl(JSON.stringify(event));
  }
}

export interface Harness {
  roles: MemoryRoleStore;
  snapshots: MemorySnapshotStore;
}

export function startServer(
  harness: Harness,
  bus: Bus,
  port = 0,
  overrides: Partial<WsServerDeps> = {},
): Promise<{ server: WsServer; port: number }> {
  const server = createWsServer({
    allowedOrigins: [ORIGIN],
    verifyJwt,
    bus,
    roles: harness.roles,
    snapshots: harness.snapshots,
    log: silentLog,
    flush: { debounceMs: 50, maxWaitMs: 500 },
    evictGraceMs: 20,
    ...overrides,
  });
  return server.listen(port).then((bound) => ({ server, port: bound }));
}

export interface TestPeer {
  userId: string;
  doc: Y.Doc;
  awareness: Awareness;
  provider: RoomProvider;
  sockets: WebSocket[];
  /** Abrupt death: TCP is destroyed with no close frame, and nothing reconnects. */
  kill(): void;
  /** The live socket. */
  socket(): WebSocket;
  destroy(): void;
}

/** A real RoomProvider over a real `ws` socket, the same code path as the browser. */
export function connectPeer(port: number, roomId: string, userId: string): TestPeer {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState({ user: { id: userId, name: 'Test', color: '#336699' } });
  const sockets: WebSocket[] = [];
  const createSocket: SocketFactory = (url, protocols) => {
    const ws = new WebSocket(url, protocols, { origin: ORIGIN });
    ws.on('error', () => undefined);
    sockets.push(ws);
    return ws as unknown as SocketLike;
  };
  const provider = new RoomProvider({
    url: `ws://127.0.0.1:${port}`,
    roomId,
    doc,
    awareness,
    getToken: () => signToken(userId),
    createSocket,
  });
  return {
    userId,
    doc,
    awareness,
    provider,
    sockets,
    kill() {
      sockets[sockets.length - 1]?.terminate();
      provider.disconnect();
    },
    socket() {
      const ws = sockets[sockets.length - 1];
      if (!ws) throw new Error('no socket yet');
      return ws;
    },
    destroy() {
      provider.destroy();
      awareness.destroy();
      doc.destroy();
    },
  };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export interface RedisInstance {
  url: string;
  stop(): Promise<void>;
}

/** Uses TEST_REDIS_URL when set, otherwise starts a throwaway local redis-server. */
export async function startRedis(): Promise<RedisInstance> {
  const external = process.env['TEST_REDIS_URL'];
  if (external) return { url: external, stop: async () => undefined };

  const port = await freePort();
  const child: ChildProcess = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore',
  });
  const url = `redis://127.0.0.1:${port}`;
  const probe = new Redis(url, { lazyConnect: true, retryStrategy: () => 50, maxRetriesPerRequest: null });
  probe.on('error', () => undefined);
  await probe.connect().catch(() => undefined);
  await probe.ping();
  probe.disconnect();
  return {
    url,
    stop: () =>
      new Promise((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}
