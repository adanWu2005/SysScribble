import { randomUUID } from 'node:crypto';
import { Y_KEYS } from '@wb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RedisBus } from '../../src/redis/bus';
import type { WsServer } from '../../src/server';
import {
  MemoryRoleStore,
  MemorySnapshotStore,
  connectPeer,
  silentLog,
  startRedis,
  startServer,
  until,
  type RedisInstance,
  type TestPeer,
} from '../helpers/harness';

const ALICE = '11111111-2222-4333-8444-555555555555';
const BOB = '99999999-8888-4777-8666-555555555555';

/** PRD §6.1: a client goes offline, both sides edit the same things, then it reconnects. */
describe('split-brain network partition', () => {
  let redis: RedisInstance;
  let server: WsServer;
  let port: number;
  const roles = new MemoryRoleStore();
  const snapshots = new MemorySnapshotStore();

  beforeAll(async () => {
    redis = await startRedis();
    ({ server, port } = await startServer({ roles, snapshots }, new RedisBus(redis.url, silentLog)));
  });

  afterAll(async () => {
    await server.close();
    await redis.stop();
  });

  function paragraph(peer: TestPeer): Y.XmlText {
    const element = peer.doc.getXmlFragment(Y_KEYS.notes).get(0) as Y.XmlElement;
    return element.get(0) as Y.XmlText;
  }

  function sticky(peer: TestPeer): Y.Map<number> {
    return peer.doc.getMap(Y_KEYS.shapes).get('sticky') as Y.Map<number>;
  }

  async function partitionedRoom(): Promise<{ a: TestPeer; b: TestPeer; roomId: string }> {
    const roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, ALICE, 'EDITOR');
    roles.set(roomId, BOB, 'EDITOR');
    const a = connectPeer(port, roomId, ALICE);
    const b = connectPeer(port, roomId, BOB);
    await until(() => a.provider.synced && b.provider.synced);

    a.doc.transact(() => {
      const element = new Y.XmlElement('paragraph');
      element.insert(0, [new Y.XmlText('shared text')]);
      a.doc.getXmlFragment(Y_KEYS.notes).insert(0, [element]);
      const shape = new Y.Map<number>();
      shape.set('x', 0);
      shape.set('y', 0);
      a.doc.getMap(Y_KEYS.shapes).set('sticky', shape);
    });
    await until(() => b.doc.getMap(Y_KEYS.shapes).has('sticky'));
    return { a, b, roomId };
  }

  it('merges same-paragraph edits and same-sticky moves without losing either side', async () => {
    const { a, b } = await partitionedRoom();

    a.provider.disconnect();
    await until(() => a.provider.status === 'disconnected');

    paragraph(a).insert(0, 'OFFLINE ');
    sticky(a).set('x', 111);
    paragraph(b).insert(paragraph(b).length, ' ONLINE');
    sticky(b).set('y', 222);

    a.provider.connect();
    // Times out, and fails, if either side's edit is ever lost.
    await until(
      () =>
        a.provider.synced &&
        paragraph(a).toString() === paragraph(b).toString() &&
        JSON.stringify(sticky(a).toJSON()) === JSON.stringify(sticky(b).toJSON()),
    );

    expect(paragraph(a).toString()).toBe('OFFLINE shared text ONLINE');
    expect(sticky(a).toJSON()).toEqual({ x: 111, y: 222 });
    expect(sticky(b).toJSON()).toEqual({ x: 111, y: 222 });

    a.destroy();
    b.destroy();
  });

  it('resolves a same-property conflict identically on both sides', async () => {
    const { a, b } = await partitionedRoom();

    a.provider.disconnect();
    await until(() => a.provider.status === 'disconnected');
    sticky(a).set('x', 1);
    sticky(b).set('x', 2);

    a.provider.connect();
    await until(() => a.provider.synced);
    await until(() => sticky(a).get('x') === sticky(b).get('x'));
    expect([1, 2]).toContain(sticky(a).get('x'));

    a.destroy();
    b.destroy();
  });

  it('survives a long partition with heavy concurrent edits on both sides', async () => {
    const { a, b, roomId } = await partitionedRoom();

    a.provider.disconnect();
    await until(() => a.provider.status === 'disconnected');
    for (let i = 0; i < 200; i++) {
      paragraph(a).insert(0, 'a');
      paragraph(b).insert(paragraph(b).length, 'b');
    }

    a.provider.connect();
    await until(() => a.provider.synced && paragraph(a).toString() === paragraph(b).toString());

    const text = paragraph(a).toString();
    expect(text.match(/a/g)?.length).toBeGreaterThanOrEqual(200);
    expect(text.match(/b/g)?.length).toBeGreaterThanOrEqual(200);
    expect(text).toBe(paragraph(b).toString());

    await until(() => snapshots.stored(roomId) !== null);
    a.destroy();
    b.destroy();
  });
});
