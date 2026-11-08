import { randomUUID } from 'node:crypto';
import { COMMENTS_KEY, encodeSyncUpdate } from '@wb/shared';
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

interface SeenState {
  pointer?: unknown;
  laser?: unknown;
  viewport?: unknown;
  selection?: unknown;
}

describe('presence over a real socket', () => {
  let roles: MemoryRoleStore;
  let hub: MemoryHub;
  let server: WsServer;
  let port: number;
  let roomId: string;
  const peers: TestPeer[] = [];

  const peer = (userId: string): TestPeer => {
    const created = connectPeer(port, roomId, userId);
    peers.push(created);
    return created;
  };
  const seen = (observer: TestPeer, of: TestPeer): SeenState | undefined =>
    observer.awareness.getStates().get(of.doc.clientID) as SeenState | undefined;

  beforeEach(async () => {
    roles = new MemoryRoleStore();
    const snapshots = new MemorySnapshotStore();
    roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, ALICE, 'EDITOR');
    roles.set(roomId, BOB, 'EDITOR');
    hub = new MemoryHub();
    ({ server, port } = await startServer({ roles, snapshots }, hub.bus()));
  });

  afterEach(async () => {
    for (const created of peers.splice(0)) created.destroy();
    await server.close();
  });

  it('shows an idle user again after their connection drops and comes back', async () => {
    const idle = peer(ALICE);
    const watcher = peer(BOB);
    await until(() => idle.provider.synced && watcher.provider.synced);
    await until(() => watcher.awareness.getStates().has(idle.doc.clientID));

    // The network dies under the idle user. They do nothing at all afterwards.
    idle.socket().terminate();
    await until(() => !watcher.awareness.getStates().has(idle.doc.clientID));

    // Without bumping its clock on reconnect, the server would ignore the returning state as stale
    // and the user would stay invisible until they moved the mouse.
    await until(() => watcher.awareness.getStates().has(idle.doc.clientID), 10_000);
  });

  const reported = (): number => {
    let total = 0;
    for (const [key, users] of hub.presence) if (key.startsWith(`${roomId}|`)) total += users;
    return total;
  };

  it('reports how many different people are in the room for the dashboard', async () => {
    expect(reported()).toBe(0);
    const a = peer(ALICE);
    await until(() => a.provider.synced);
    await until(() => reported() === 1);

    // A second tab of the same person is still one person.
    const second = peer(ALICE);
    await until(() => second.provider.synced);
    await sleep(100);
    expect(reported()).toBe(1);

    const b = peer(BOB);
    await until(() => b.provider.synced);
    await until(() => reported() === 2);

    b.destroy();
    await until(() => reported() === 1);
    a.destroy();
    second.destroy();
    await until(() => reported() === 0);
  });

  it('measures round-trip latency for every role', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.latency !== null && viewer.provider.latency !== null);
    expect(editor.provider.latency).toBeGreaterThanOrEqual(0);
    expect(editor.provider.latency).toBeLessThan(2000);
    expect(viewer.provider.latency).toBeGreaterThanOrEqual(0);
  });

  it('reports no latency once the connection is gone', async () => {
    const a = peer(ALICE);
    await until(() => a.provider.latency !== null);
    a.provider.disconnect();
    expect(a.provider.latency).toBeNull();
  });

  it('delivers an editor laser, viewport and selection to everyone', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    editor.awareness.setLocalStateField('laser', { x: 5, y: 6 });
    editor.awareness.setLocalStateField('viewport', { cx: 100, cy: 200, scale: 2 });
    editor.awareness.setLocalStateField('selection', ['shape-1']);
    await until(() => {
      const state = seen(viewer, editor);
      return state?.laser !== undefined && state.viewport !== undefined && state.selection !== undefined;
    });
    expect(seen(viewer, editor)?.laser).toEqual({ x: 5, y: 6 });
  });

  it('never delivers a viewer laser, even when it skips the UI and sends it anyway', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    // The provider is not a security control, so this goes out exactly as a hostile client's would.
    viewer.awareness.setLocalStateField('laser', { x: 1, y: 2 });
    viewer.awareness.setLocalStateField('drawing', true);
    await sleep(200);

    const state = seen(editor, viewer);
    expect(state?.laser).toBeUndefined();
    expect((state as { drawing?: unknown } | undefined)?.drawing).toBeUndefined();
    // The viewer's first frame (a plain identity) was fine. Nothing after it, with a laser, was kept.
    const held = server.manager.get(roomId)?.awareness.getStates().get(viewer.doc.clientID) as SeenState | undefined;
    expect(held?.laser).toBeUndefined();
  });

  it('lets a viewer use cursor chat and reactions, which never touch the document', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    viewer.awareness.setLocalStateField('chat', { text: 'looks good' });
    viewer.awareness.setLocalStateField('reaction', { emoji: '🎉', n: 1 });
    await until(() => {
      const state = seen(editor, viewer) as { chat?: unknown; reaction?: unknown } | undefined;
      return state?.chat !== undefined && state.reaction !== undefined;
    });
    const state = seen(editor, viewer) as { chat?: { text: string }; reaction?: { emoji: string } } | undefined;
    expect(state?.chat?.text).toBe('looks good');
    expect(state?.reaction?.emoji).toBe('🎉');
  });

  it('drops a comment a viewer writes straight to the socket, and keeps an editor comment', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    const real = new Y.Map<unknown>();
    editor.doc.getMap(COMMENTS_KEY).set('real', real);
    real.set('x', 1);
    await until(() => viewer.doc.getMap(COMMENTS_KEY).has('real'));

    const forged = new Y.Doc();
    forged.getMap(COMMENTS_KEY).set('forged', true);
    viewer.socket().send(encodeSyncUpdate(Y.encodeStateAsUpdate(forged)));
    await sleep(150);

    expect(editor.doc.getMap(COMMENTS_KEY).has('forged')).toBe(false);
    expect(server.manager.get(roomId)?.doc.getMap(COMMENTS_KEY).has('forged')).toBe(false);
    expect(server.manager.get(roomId)?.doc.getMap(COMMENTS_KEY).has('real')).toBe(true);
  });

  it('lets a viewer who switches the laser off appear again', async () => {
    roles.set(roomId, BOB, 'VIEWER');
    const editor = peer(ALICE);
    const viewer = peer(BOB);
    await until(() => editor.provider.synced && viewer.provider.synced);

    viewer.awareness.setLocalStateField('laser', { x: 1, y: 2 });
    await sleep(100);
    viewer.awareness.setLocalStateField('laser', null);
    viewer.awareness.setLocalStateField('drawing', false);
    viewer.awareness.setLocalStateField('pointer', { x: 7, y: 8 });

    await until(() => seen(editor, viewer)?.pointer !== undefined);
    expect(seen(editor, viewer)?.pointer).toEqual({ x: 7, y: 8 });
    expect(seen(editor, viewer)?.laser ?? null).toBeNull();
  });

  it('stops a downgraded editor laser from reaching anyone', async () => {
    const editor = peer(ALICE);
    const watcher = peer(BOB);
    await until(() => editor.provider.synced && watcher.provider.synced);

    editor.awareness.setLocalStateField('laser', { x: 1, y: 1 });
    await until(() => seen(watcher, editor)?.laser !== undefined);

    const room = server.manager.get(roomId);
    expect(room).toBeDefined();
    // Downgrade the editor on the server, as a role change from the owner would.
    for (const client of room?.clients ?? []) if (client.data.userId === ALICE) client.setRole('VIEWER');

    editor.awareness.setLocalStateField('laser', { x: 99, y: 99 });
    await sleep(200);
    expect(seen(watcher, editor)?.laser).toEqual({ x: 1, y: 1 });
  });
});
