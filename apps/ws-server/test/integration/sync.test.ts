import { randomUUID } from 'node:crypto';
import { WS_CLOSE, Y_KEYS, encodeSyncUpdate } from '@wb/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { WsServer } from '../../src/server';
import {
  MemoryHub,
  MemoryRoleStore,
  MemorySnapshotStore,
  connectPeer,
  sleep,
  startServer,
  until,
  type TestPeer,
} from '../helpers/harness';

const ALICE = '11111111-2222-4333-8444-555555555555';
const BOB = '99999999-8888-4777-8666-555555555555';

function stored(snapshots: MemorySnapshotStore, roomId: string): Y.Doc {
  const doc = new Y.Doc();
  const bytes = snapshots.stored(roomId);
  if (bytes) Y.applyUpdate(doc, bytes);
  return doc;
}

describe('room sync', () => {
  let roles: MemoryRoleStore;
  let snapshots: MemorySnapshotStore;
  let hub: MemoryHub;
  let server: WsServer;
  let port: number;
  let roomId: string;
  const peers: TestPeer[] = [];

  function peer(userId: string): TestPeer {
    const created = connectPeer(port, roomId, userId);
    peers.push(created);
    return created;
  }

  beforeEach(async () => {
    roles = new MemoryRoleStore();
    snapshots = new MemorySnapshotStore();
    hub = new MemoryHub();
    roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, ALICE, 'EDITOR');
    roles.set(roomId, BOB, 'EDITOR');
    ({ server, port } = await startServer({ roles, snapshots }, hub.bus()));
  });

  afterEach(async () => {
    for (const created of peers.splice(0)) created.destroy();
    await server.close();
  });

  it('two editors converge and live cursors flow', async () => {
    const a = peer(ALICE);
    const b = peer(BOB);
    await until(() => a.provider.synced && b.provider.synced);

    a.doc.getMap(Y_KEYS.shapes).set('s1', 'from-a');
    b.doc.getMap(Y_KEYS.shapes).set('s2', 'from-b');
    await until(() => a.doc.getMap(Y_KEYS.shapes).size === 2 && b.doc.getMap(Y_KEYS.shapes).size === 2);

    a.awareness.setLocalStateField('pointer', { x: 10, y: 20 });
    await until(() => (b.awareness.getStates().get(a.doc.clientID) as { pointer?: unknown })?.pointer !== undefined);
  });

  it('a viewer sees edits, and its forged frames reach nobody', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    editor.doc.getMap(Y_KEYS.shapes).set('s1', 1);
    await until(() => viewer.doc.getMap(Y_KEYS.shapes).get('s1') === 1);

    // DevTools attack: skip the provider and write straight to the socket.
    const forged = new Y.Doc();
    forged.getMap(Y_KEYS.shapes).set('hacked', true);
    viewer.socket().send(encodeSyncUpdate(Y.encodeStateAsUpdate(forged)));
    await sleep(100);

    expect(editor.doc.getMap(Y_KEYS.shapes).has('hacked')).toBe(false);
    expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('hacked')).toBe(false);
  });

  it('removes a departing cursor from everyone else', async () => {
    const a = peer(ALICE);
    const b = peer(BOB);
    await until(() => b.awareness.getStates().has(a.doc.clientID));
    a.kill();
    await until(() => !b.awareness.getStates().has(a.doc.clientID));
  });

  it('flushes on debounce, then reloads the document after eviction', async () => {
    const a = peer(ALICE);
    await until(() => a.provider.synced);
    a.doc.getMap(Y_KEYS.shapes).set('kept', 'yes');
    await until(() => snapshots.writes === 1);
    expect(stored(snapshots, roomId).getMap(Y_KEYS.shapes).get('kept')).toBe('yes');

    a.destroy();
    peers.splice(0);
    await until(() => server.manager.get(roomId) === undefined);

    const b = peer(BOB);
    await until(() => b.doc.getMap(Y_KEYS.shapes).get('kept') === 'yes');
  });

  it('flushes when the last client leaves', async () => {
    const a = peer(ALICE);
    await until(() => a.provider.synced);
    const writes = snapshots.writes;
    a.doc.getMap(Y_KEYS.shapes).set('final', 1);
    await sleep(5);
    a.destroy();
    peers.splice(0);
    await until(() => snapshots.writes === writes + 1);
    expect(stored(snapshots, roomId).getMap(Y_KEYS.shapes).get('final')).toBe(1);
  });

  it('a stale writer merges instead of overwriting', async () => {
    const a = peer(ALICE);
    await until(() => a.provider.synced);
    a.doc.getMap(Y_KEYS.shapes).set('mine', 1);
    await until(() => snapshots.writes === 1);

    // Another instance stored something this instance has never seen.
    const other = new Y.Doc();
    Y.applyUpdate(other, snapshots.stored(roomId) as Uint8Array);
    other.getMap(Y_KEYS.shapes).set('theirs', 2);
    await snapshots.save(roomId, Y.encodeStateAsUpdate(other), 2);

    a.doc.getMap(Y_KEYS.shapes).set('later', 3);
    await until(() => snapshots.writes === 3);

    const final = stored(snapshots, roomId).getMap(Y_KEYS.shapes);
    expect(final.get('mine')).toBe(1);
    expect(final.get('theirs')).toBe(2);
    expect(final.get('later')).toBe(3);
    await until(() => a.doc.getMap(Y_KEYS.shapes).get('theirs') === 2);
  });

  it('compaction: a snapshot stays far smaller than the edits that produced it', async () => {
    const a = peer(ALICE);
    await until(() => a.provider.synced);
    const shape = new Y.Map<number>();
    a.doc.getMap(Y_KEYS.shapes).set('drag', shape);
    let incremental = 0;
    a.doc.on('update', (update: Uint8Array) => {
      incremental += update.length;
    });
    for (let i = 0; i < 1000; i++) shape.set('x', i);
    await until(() => snapshots.writes >= 1);
    await sleep(100);

    const bytes = snapshots.stored(roomId) as Uint8Array;
    expect(bytes.length).toBeLessThan(incremental / 10);

    const started = performance.now();
    Y.applyUpdate(new Y.Doc(), bytes);
    expect(performance.now() - started).toBeLessThan(100);
  });

  describe('control events', () => {
    async function connected(): Promise<TestPeer> {
      const a = peer(ALICE);
      await until(() => a.provider.synced);
      return a;
    }

    it.each([
      ['MEMBER_REMOVED', WS_CLOSE.REMOVED],
      ['KICK', WS_CLOSE.KICKED],
    ])('%s closes the socket and stops reconnects', async (type, code) => {
      const a = await connected();
      const terminated = new Promise<number>((resolve) => a.provider.on('terminated', resolve));
      hub.control(roomId, { type, roomId, userId: ALICE });
      expect(await terminated).toBe(code);
    });

    it('ROOM_DELETED closes everyone and writes nothing afterwards', async () => {
      const a = await connected();
      const terminated = new Promise<number>((resolve) => a.provider.on('terminated', resolve));
      a.doc.getMap(Y_KEYS.shapes).set('doomed', 1);
      snapshots.deleteRoom(roomId);
      hub.control(roomId, { type: 'ROOM_DELETED', roomId });
      expect(await terminated).toBe(WS_CLOSE.ROOM_DELETED);
      const writes = snapshots.writes;
      await sleep(100);
      expect(snapshots.writes).toBe(writes);
    });

    it('ignores an event addressed to another room', async () => {
      const a = await connected();
      hub.control(roomId, { type: 'KICK', roomId: randomUUID(), userId: ALICE });
      await sleep(30);
      expect(a.provider.status).toBe('connected');
    });

    it('ignores malformed control JSON', async () => {
      const a = await connected();
      for (const handlers of hub.rooms.get(roomId) ?? []) handlers.onControl('{not json');
      await sleep(10);
      expect(a.provider.status).toBe('connected');
    });
  });
});
