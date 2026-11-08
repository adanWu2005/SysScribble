import { randomUUID } from 'node:crypto';
import { Y_KEYS } from '@wb/shared';
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

/** What a restore does to a document: replace the shapes, their order and the notes in one transaction. */
function replaceEverything(doc: Y.Doc, label: string): void {
  doc.transact(() => {
    const shapes = doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes);
    for (const id of Array.from(shapes.keys())) shapes.delete(id);
    const restored = new Y.Map<unknown>();
    restored.set('type', 'rect');
    restored.set('label', label);
    shapes.set(label, restored);

    const order = doc.getArray<string>(Y_KEYS.order);
    order.delete(0, order.length);
    order.push([label]);

    const notes = doc.getXmlFragment(Y_KEYS.notes);
    notes.delete(0, notes.length);
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(label)]);
    notes.insert(0, [paragraph]);
  }, 'history-restore');
}

const shapeIds = (doc: Y.Doc) => Array.from(doc.getMap(Y_KEYS.shapes).keys());

describe('a version restore, as the realtime server sees it', () => {
  let roles: MemoryRoleStore;
  let snapshots: MemorySnapshotStore;
  let server: WsServer;
  let port: number;
  let roomId: string;
  const peers: TestPeer[] = [];

  const peer = (userId: string): TestPeer => {
    const created = connectPeer(port, roomId, userId);
    peers.push(created);
    return created;
  };

  beforeEach(async () => {
    roles = new MemoryRoleStore();
    snapshots = new MemorySnapshotStore();
    roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, ALICE, 'EDITOR');
    roles.set(roomId, BOB, 'VIEWER');
    ({ server, port } = await startServer({ roles, snapshots }, new MemoryHub().bus()));
  });

  afterEach(async () => {
    for (const created of peers.splice(0)) created.destroy();
    await server.close();
  });

  it('reaches everyone and is saved, when an editor does it', async () => {
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    editor.doc.getMap(Y_KEYS.shapes).set('current', new Y.Map());
    await until(() => viewer.doc.getMap(Y_KEYS.shapes).has('current'));

    replaceEverything(editor.doc, 'restored');
    await until(() => shapeIds(viewer.doc).join() === 'restored');
    expect(shapeIds(server.manager.get(roomId)?.doc ?? new Y.Doc())).toEqual(['restored']);

    // And it is persisted, so a reload shows the restored version.
    // An earlier save (of 'current') may already have happened, so wait for the saved content itself.
    const savedShapes = () => {
      const saved = new Y.Doc();
      const bytes = snapshots.stored(roomId);
      if (bytes) Y.applyUpdate(saved, bytes);
      return shapeIds(saved);
    };
    await until(() => savedShapes().join() === 'restored');
    expect(savedShapes()).toEqual(['restored']);
  });

  it('is dropped, whole, when a viewer sends it', async () => {
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);
    editor.doc.getMap(Y_KEYS.shapes).set('current', new Y.Map());
    await until(() => viewer.doc.getMap(Y_KEYS.shapes).has('current'));

    // DevTools attack: the viewer's own copy is changed and its sync frame sent anyway.
    replaceEverything(viewer.doc, 'hijacked');
    await sleep(250);

    expect(shapeIds(editor.doc)).toEqual(['current']);
    expect(shapeIds(server.manager.get(roomId)?.doc ?? new Y.Doc())).toEqual(['current']);
    expect(editor.doc.getXmlFragment(Y_KEYS.notes).length).toBe(0);
  });

  it('is dropped for an editor who was downgraded a moment before', async () => {
    const editor = peer(ALICE);
    await until(() => editor.provider.synced);
    editor.doc.getMap(Y_KEYS.shapes).set('current', new Y.Map());
    await until(() => server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('current') === true);

    for (const client of server.manager.get(roomId)?.clients ?? []) client.setRole('VIEWER');
    replaceEverything(editor.doc, 'late');
    await sleep(250);

    expect(shapeIds(server.manager.get(roomId)?.doc ?? new Y.Doc())).toEqual(['current']);
  });
});
