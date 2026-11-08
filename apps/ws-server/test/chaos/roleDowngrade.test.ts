import { randomUUID } from 'node:crypto';
import { Y_KEYS, controlChannel, encodeSyncUpdate, kickBanKey } from '@wb/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
} from '../helpers/harness';

const OWNER = '11111111-2222-4333-8444-555555555555';
const EDITOR = '99999999-8888-4777-8666-555555555555';
const BUDGET_MS = 100;

/** PRD §6.4: an editor is mid-stroke when the owner downgrades them over REST. */
describe('stale role downgrade race', () => {
  let redis: RedisInstance;
  let server: WsServer;
  let port: number;
  let publisher: Redis;
  const roles = new MemoryRoleStore();
  const snapshots = new MemorySnapshotStore();

  function room(): string {
    const roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, OWNER, 'OWNER');
    roles.set(roomId, EDITOR, 'EDITOR');
    return roomId;
  }

  /** What the REST route does: commit to the database, then publish. */
  function downgrade(roomId: string): Promise<number> {
    roles.set(roomId, EDITOR, 'VIEWER');
    return publisher.publish(
      controlChannel(roomId),
      JSON.stringify({ type: 'ROLE_CHANGED', roomId, userId: EDITOR, role: 'VIEWER' }),
    );
  }

  beforeAll(async () => {
    redis = await startRedis();
    publisher = new Redis(redis.url);
    ({ server, port } = await startServer({ roles, snapshots }, new RedisBus(redis.url, silentLog)));
  });

  afterAll(async () => {
    publisher.disconnect();
    await server.close();
    await redis.stop();
  });

  it(`downgrades within ${BUDGET_MS} ms and rejects drawing without a refresh`, async () => {
    const roomId = room();
    const owner = connectPeer(port, roomId, OWNER);
    const editor = connectPeer(port, roomId, EDITOR);
    await until(() => owner.provider.synced && editor.provider.synced);

    // The editor keeps drawing throughout, including right across the downgrade.
    const shapes = editor.doc.getMap<number>(Y_KEYS.shapes);
    let drawing = true;
    const stroke = (async () => {
      for (let i = 0; drawing; i++) {
        shapes.set('stroke', i);
        await sleep(5);
      }
    })();
    await until(() => owner.doc.getMap(Y_KEYS.shapes).has('stroke'));

    const serverClient = () =>
      Array.from(server.manager.get(roomId)?.clients ?? []).find((c) => c.data.userId === EDITOR);

    const started = performance.now();
    await downgrade(roomId);
    await until(() => serverClient()?.data.role === 'VIEWER', 1000, 'server-side role');
    const serverElapsed = performance.now() - started;
    await until(() => editor.provider.role === 'VIEWER', 1000, 'client-side role');
    const clientElapsed = performance.now() - started;

    console.warn(`[downgrade] server ${serverElapsed.toFixed(1)} ms, client ${clientElapsed.toFixed(1)} ms`);
    expect(serverElapsed).toBeLessThan(BUDGET_MS);
    expect(clientElapsed).toBeLessThan(BUDGET_MS);

    // A hostile client ignores the role frame and keeps sending from the same socket.
    const forged = new Y.Doc();
    forged.getMap(Y_KEYS.shapes).set('after-downgrade', true);
    const frame = encodeSyncUpdate(Y.encodeStateAsUpdate(forged));
    const snapshotOfStroke = owner.doc.getMap(Y_KEYS.shapes).get('stroke');
    for (let i = 0; i < 10; i++) editor.socket().send(frame);
    await sleep(100);
    drawing = false;
    await stroke;

    expect(owner.doc.getMap(Y_KEYS.shapes).has('after-downgrade')).toBe(false);
    expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('after-downgrade')).toBe(false);
    await sleep(50);
    expect(owner.doc.getMap(Y_KEYS.shapes).get('stroke')).toBe(snapshotOfStroke);
    expect(editor.socket().readyState).toBe(1);

    owner.destroy();
    editor.destroy();
  });

  it('never lets an in-flight burst win against a downgrade, over 20 rounds', async () => {
    for (let round = 0; round < 20; round++) {
      const roomId = room();
      const owner = connectPeer(port, roomId, OWNER);
      const editor = connectPeer(port, roomId, EDITOR);
      await until(() => owner.provider.synced && editor.provider.synced);

      await downgrade(roomId);
      await until(() => editor.provider.role === 'VIEWER');

      const forged = new Y.Doc();
      forged.getMap(Y_KEYS.shapes).set('late', round);
      editor.socket().send(encodeSyncUpdate(Y.encodeStateAsUpdate(forged)));
      await sleep(20);
      expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('late')).toBe(false);

      owner.destroy();
      editor.destroy();
    }
  });

  it('removal terminates the socket and reconnecting is refused', async () => {
    const roomId = room();
    const editor = connectPeer(port, roomId, EDITOR);
    await until(() => editor.provider.synced);

    const terminated = new Promise<number>((resolve) => editor.provider.on('terminated', resolve));
    roles.set(roomId, EDITOR, null);
    const started = performance.now();
    await publisher.publish(
      controlChannel(roomId),
      JSON.stringify({ type: 'MEMBER_REMOVED', roomId, userId: EDITOR }),
    );
    await terminated;
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    editor.destroy();

    const again = connectPeer(port, roomId, EDITOR);
    await sleep(150);
    expect(again.provider.status).not.toBe('connected');
    again.destroy();
  });

  it('a kick survives a reconnect attempt through the Redis ban key', async () => {
    const roomId = room();
    const editor = connectPeer(port, roomId, EDITOR);
    await until(() => editor.provider.synced);

    await publisher.set(kickBanKey(roomId, EDITOR), '1', 'PX', 60_000);
    await publisher.publish(controlChannel(roomId), JSON.stringify({ type: 'KICK', roomId, userId: EDITOR }));
    await until(() => editor.provider.status === 'disconnected');
    editor.destroy();

    const again = connectPeer(port, roomId, EDITOR);
    await sleep(150);
    expect(again.provider.status).not.toBe('connected');
    again.destroy();
  });
});
