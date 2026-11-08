import { randomUUID } from 'node:crypto';
import { Y_KEYS } from '@wb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const ALICE = '11111111-2222-4333-8444-555555555555';
const BOB = '99999999-8888-4777-8666-555555555555';
const PORT_A = 4001;
const PORT_B = 4002;
const SAMPLES = 60;
const ADDED_LATENCY_BUDGET_MS = 50;

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Round-trip-free one-way latency, measured in one process so both clocks are the same. */
async function measureLatency(sender: TestPeer, receiver: TestPeer): Promise<number[]> {
  const samples: number[] = [];
  const key = randomUUID();
  const senderMap = sender.doc.getMap<number>(Y_KEYS.meta);
  const receiverMap = receiver.doc.getMap<number>(Y_KEYS.meta);
  for (let i = 0; i < SAMPLES; i++) {
    const started = performance.now();
    senderMap.set(key, i);
    await until(() => receiverMap.get(key) === i, 2000, `sample ${i}`);
    samples.push(performance.now() - started);
    await sleep(25);
  }
  return samples;
}

/** PRD §6.2: two instances on 4001 and 4002 sharing one real Redis. */
describe('multi-server pub/sub', () => {
  let redis: RedisInstance;
  let serverA: WsServer;
  let serverB: WsServer;
  const roles = new MemoryRoleStore();
  const snapshots = new MemorySnapshotStore();

  function room(): string {
    const roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, ALICE, 'EDITOR');
    roles.set(roomId, BOB, 'EDITOR');
    return roomId;
  }

  beforeAll(async () => {
    redis = await startRedis();
    ({ server: serverA } = await startServer({ roles, snapshots }, new RedisBus(redis.url, silentLog), PORT_A, {
      flush: { debounceMs: 60_000, maxWaitMs: 120_000 },
    }));
    ({ server: serverB } = await startServer({ roles, snapshots }, new RedisBus(redis.url, silentLog), PORT_B, {
      flush: { debounceMs: 60_000, maxWaitMs: 120_000 },
    }));
  });

  afterAll(async () => {
    await serverA.close();
    await serverB.close();
    await redis.stop();
  });

  it('syncs canvas edits and cursors across ports', async () => {
    const roomId = room();
    const a = connectPeer(PORT_A, roomId, ALICE);
    const b = connectPeer(PORT_B, roomId, BOB);
    await until(() => a.provider.synced && b.provider.synced);

    a.doc.getMap(Y_KEYS.shapes).set('from-4001', 1);
    b.doc.getMap(Y_KEYS.shapes).set('from-4002', 2);
    await until(() => a.doc.getMap(Y_KEYS.shapes).size === 2 && b.doc.getMap(Y_KEYS.shapes).size === 2);

    a.awareness.setLocalStateField('pointer', { x: 5, y: 6 });
    await until(
      () => (b.awareness.getStates().get(a.doc.clientID) as { pointer?: unknown } | undefined)?.pointer !== undefined,
    );

    a.kill();
    await until(() => !b.awareness.getStates().has(a.doc.clientID));

    a.destroy();
    b.destroy();
  });

  it(`adds under ${ADDED_LATENCY_BUDGET_MS} ms compared with staying on one instance`, async () => {
    const sameRoom = room();
    const local1 = connectPeer(PORT_A, sameRoom, ALICE);
    const local2 = connectPeer(PORT_A, sameRoom, BOB);
    await until(() => local1.provider.synced && local2.provider.synced);
    const baseline = median(await measureLatency(local1, local2));
    local1.destroy();
    local2.destroy();

    const crossRoom = room();
    const a = connectPeer(PORT_A, crossRoom, ALICE);
    const b = connectPeer(PORT_B, crossRoom, BOB);
    await until(() => a.provider.synced && b.provider.synced);
    const cross = median(await measureLatency(a, b));
    a.destroy();
    b.destroy();

    const added = cross - baseline;
    console.warn(`[latency] one instance ${baseline.toFixed(1)} ms, cross instance ${cross.toFixed(1)} ms, added ${added.toFixed(1)} ms`);
    expect(added).toBeLessThan(ADDED_LATENCY_BUDGET_MS);
  });

  it('a late-joining instance receives edits that exist only in a peer\'s memory', async () => {
    const roomId = room();
    const a = connectPeer(PORT_A, roomId, ALICE);
    await until(() => a.provider.synced);
    a.doc.getMap(Y_KEYS.shapes).set('unflushed', 'in-memory-only');
    await sleep(100);
    expect(snapshots.stored(roomId)).toBeNull();

    const b = connectPeer(PORT_B, roomId, BOB);
    await until(() => b.doc.getMap(Y_KEYS.shapes).get('unflushed') === 'in-memory-only');

    a.destroy();
    b.destroy();
  });

  it('control events reach sockets on every instance', async () => {
    const roomId = room();
    const a = connectPeer(PORT_A, roomId, ALICE);
    const b1 = connectPeer(PORT_A, roomId, BOB);
    const b2 = connectPeer(PORT_B, roomId, BOB);
    await until(() => a.provider.synced && b1.provider.synced && b2.provider.synced);

    const bus = new RedisBus(redis.url, silentLog);
    const { Redis } = await import('ioredis');
    const publisher = new Redis(redis.url);
    await publisher.publish(
      `room:${roomId}:control`,
      JSON.stringify({ type: 'ROLE_CHANGED', roomId, userId: BOB, role: 'VIEWER' }),
    );
    await until(() => b1.provider.role === 'VIEWER' && b2.provider.role === 'VIEWER');
    expect(a.provider.role).toBe('EDITOR');

    publisher.disconnect();
    await bus.close();
    a.destroy();
    b1.destroy();
    b2.destroy();
  });
});
