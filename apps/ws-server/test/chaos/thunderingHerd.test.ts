import { randomUUID } from 'node:crypto';
import { Y_KEYS } from '@wb/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RedisBus } from '../../src/redis/bus';
import type { WsServer } from '../../src/server';
import {
  MemoryRoleStore,
  MemorySnapshotStore,
  connectPeer,
  silentLog,
  sleep,
  startRedis,
  startServer,
  until,
  type RedisInstance,
  type TestPeer,
} from '../helpers/harness';

const CLIENTS = 20;
const OPS_PER_SECOND = 30;
const EDIT_DURATION_MS = 2000;

/** Each client writes to its own key, so a lost update is detectable afterwards. */
async function editConcurrently(peers: TestPeer[]): Promise<void> {
  const intervalMs = 1000 / OPS_PER_SECOND;
  const total = Math.floor(EDIT_DURATION_MS / intervalMs);
  await Promise.all(
    peers.map(async (peer, index) => {
      const map = peer.doc.getMap<number>(Y_KEYS.shapes);
      await sleep(index);
      for (let i = 0; i < total; i++) {
        map.set(`client-${index}`, i);
        await sleep(intervalMs);
      }
    }),
  );
}

function storedDoc(snapshots: MemorySnapshotStore, roomId: string): Y.Map<number> {
  const doc = new Y.Doc();
  const bytes = snapshots.stored(roomId);
  if (bytes) Y.applyUpdate(doc, bytes);
  return doc.getMap<number>(Y_KEYS.shapes);
}

/** PRD §6.3: 20 clients at 30 ops/sec, then 19 die at the same instant. */
describe('thundering herd', () => {
  let redis: RedisInstance;
  let server: WsServer;
  let second: WsServer | undefined;
  let port: number;
  let roomId: string;
  let roles: MemoryRoleStore;
  let snapshots: MemorySnapshotStore;
  let peers: TestPeer[];

  async function connectAll(ports: number[]): Promise<void> {
    peers = Array.from({ length: CLIENTS }, (_, i) => {
      const userId = randomUUID();
      roles.set(roomId, userId, 'EDITOR');
      return connectPeer(ports[i % ports.length] as number, roomId, userId);
    });
    await until(() => peers.every((peer) => peer.provider.synced), 10_000, 'all peers synced');
  }

  beforeEach(async () => {
    redis = await startRedis();
    roles = new MemoryRoleStore();
    snapshots = new MemorySnapshotStore();
    snapshots.saveDelayMs = 20;
    roomId = randomUUID();
    snapshots.createRoom(roomId);
    ({ server, port } = await startServer({ roles, snapshots }, new RedisBus(redis.url, silentLog), 0, {
      flush: { debounceMs: 300, maxWaitMs: 30_000 },
    }));
  });

  afterEach(async () => {
    for (const peer of peers) peer.destroy();
    await server.close();
    await second?.close();
    second = undefined;
    await redis.stop();
  });

  it('killing 19 of 20 sockets produces one write with no concurrency', async () => {
    await connectAll([port]);
    await editConcurrently(peers);

    await until(() => {
      const map = server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes);
      return map?.size === CLIENTS;
    });

    const writesBefore = snapshots.writes;
    const survivor = peers[0] as TestPeer;
    for (const peer of peers.slice(1)) peer.kill();

    await until(() => server.manager.get(roomId)?.clients.size === 1, 5000, 'sockets gone');
    await until(() => snapshots.writes > writesBefore, 5000, 'flush');
    await sleep(600);

    expect(snapshots.writes - writesBefore).toBe(1);
    expect(snapshots.maxConcurrentSaves).toBe(1);
    expect(survivor.provider.status).toBe('connected');

    const stored = storedDoc(snapshots, roomId);
    expect(stored.size).toBe(CLIENTS);
    expect(stored.toJSON()).toEqual(survivor.doc.getMap(Y_KEYS.shapes).toJSON());
  });

  it('killing all 20 flushes exactly once and evicts the room', async () => {
    await connectAll([port]);
    await editConcurrently(peers);
    await until(() => server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).size === CLIENTS);

    const writesBefore = snapshots.writes;
    const expected = server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).toJSON();
    for (const peer of peers) peer.kill();

    await until(() => server.manager.get(roomId) === undefined, 8000, 'eviction');
    expect(snapshots.writes - writesBefore).toBeLessThanOrEqual(1);
    expect(snapshots.maxConcurrentSaves).toBe(1);
    expect(storedDoc(snapshots, roomId).toJSON()).toEqual(expected);
  });

  it('two instances flushing the same room never overlap and lose nothing', async () => {
    const started = await startServer({ roles, snapshots }, new RedisBus(redis.url, silentLog), 0, {
      flush: { debounceMs: 300, maxWaitMs: 30_000 },
    });
    second = started.server;

    await connectAll([port, started.port]);
    await editConcurrently(peers);
    await until(
      () =>
        server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).size === CLIENTS &&
        started.server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).size === CLIENTS,
    );

    for (const peer of peers) peer.kill();
    await until(
      () => server.manager.get(roomId) === undefined && started.server.manager.get(roomId) === undefined,
      10_000,
      'eviction on both instances',
    );

    expect(snapshots.maxConcurrentSaves).toBe(1);
    expect(storedDoc(snapshots, roomId).size).toBe(CLIENTS);
  });
});
