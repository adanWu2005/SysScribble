import { randomUUID } from 'node:crypto';
import { WS_CLOSE, Y_KEYS } from '@wb/shared';
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

const keys = (doc: Y.Doc) => Array.from(doc.getMap(Y_KEYS.shapes).keys()).sort();
const put = (doc: Y.Doc, id: string) => doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes).set(id, new Y.Map());

describe('the Chaos Lab against a real server', () => {
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
  const ready = (...list: TestPeer[]) => until(() => list.every((p) => p.provider.synced));

  beforeEach(async () => {
    roles = new MemoryRoleStore();
    snapshots = new MemorySnapshotStore();
    roomId = randomUUID();
    snapshots.createRoom(roomId);
    roles.set(roomId, ALICE, 'EDITOR');
    roles.set(roomId, BOB, 'EDITOR');
    ({ server, port } = await startServer({ roles, snapshots }, new MemoryHub().bus()));
  });

  afterEach(async () => {
    for (const created of peers.splice(0)) created.destroy();
    await server.close();
  });

  describe('server numbers', () => {
    it('answers with the pending edit count, then clears it after the save', async () => {
      const a = peer(ALICE);
      await ready(a);

      for (let i = 0; i < 5; i++) put(a.doc, `s${i}`);
      await sleep(5);
      a.provider.requestStats();
      await until(() => a.provider.roomStats !== null);
      // Depending on timing the debounced save may already have run. What must hold is the ordering.
      const early = a.provider.roomStats;
      expect(early?.sockets).toBe(1);

      await until(() => snapshots.writes >= 1);
      await sleep(450);
      a.provider.requestStats();
      await until(() => (a.provider.roomStats?.serverTime ?? 0) > (early?.serverTime ?? 0));
      expect(a.provider.roomStats?.pendingEdits).toBe(0);
      expect(a.provider.roomStats?.lastFlushOutcome).toBe('saved');
      expect(a.provider.roomStats?.lastFlushAt).not.toBeNull();
    });

    it('measures ages against the server clock', async () => {
      const a = peer(ALICE);
      await ready(a);
      put(a.doc, 's');
      await until(() => snapshots.writes >= 1);
      await sleep(450);
      a.provider.requestStats();
      await until(() => a.provider.roomStats?.lastFlushAt != null);
      const stats = a.provider.roomStats;
      const age = (stats?.serverTime ?? 0) - (stats?.lastFlushAt ?? 0);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(10_000);
    });

    it('counts the sockets on this instance', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.requestStats();
      await until(() => a.provider.roomStats !== null);
      expect(a.provider.roomStats?.sockets).toBe(2);
    });

    it('answers a viewer too', async () => {
      roles.set(roomId, BOB, 'VIEWER');
      const viewer = peer(BOB);
      await ready(viewer);
      viewer.provider.requestStats();
      await until(() => viewer.provider.roomStats !== null);
    });
  });

  describe('artificial latency', () => {
    it('delays what a peer sends and what it receives', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);

      const measure = async (from: TestPeer, to: TestPeer, id: string) => {
        const started = performance.now();
        put(from.doc, id);
        await until(() => to.doc.getMap(Y_KEYS.shapes).has(id), 8000);
        return performance.now() - started;
      };

      const baseline = await measure(b, a, 'baseline');
      expect(baseline).toBeLessThan(250);

      a.provider.setArtificialLatency(300);
      expect(a.provider.chaos.latencyMs).toBe(300);
      const incoming = await measure(b, a, 'incoming');
      const outgoing = await measure(a, b, 'outgoing');
      expect(incoming).toBeGreaterThanOrEqual(280);
      expect(outgoing).toBeGreaterThanOrEqual(280);
    });

    it('delays presence as well, so cursors visibly lag', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.setArtificialLatency(400);

      const started = performance.now();
      a.awareness.setLocalStateField('pointer', { x: 1, y: 2 });
      await until(() => (b.awareness.getStates().get(a.doc.clientID) as { pointer?: unknown } | undefined)?.pointer !== undefined, 8000);
      expect(performance.now() - started).toBeGreaterThanOrEqual(380);
    });

    it('raises the round trip the badge shows', async () => {
      const a = peer(ALICE);
      await ready(a);
      await until(() => a.provider.latency !== null);
      const before = a.provider.latency ?? 0;
      a.provider.setArtificialLatency(250);
      a.provider.requestStats();
      // The next ping reports the new conditions. Stats requests cross the same delayed link.
      const started = performance.now();
      const seen = a.provider.roomStats?.serverTime ?? 0;
      await until(() => (a.provider.roomStats?.serverTime ?? 0) > seen, 8000);
      expect(performance.now() - started).toBeGreaterThanOrEqual(480);
      expect(before).toBeLessThan(250);
    });

    it('keeps edits in order and loses none, whatever the delay', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.setArtificialLatency(200);
      for (let i = 0; i < 30; i++) {
        put(a.doc, `n${String(i).padStart(2, '0')}`);
        await sleep(15);
      }
      await until(() => keys(b.doc).length === 30, 10_000);
      expect(keys(b.doc)).toEqual(keys(a.doc));
    });

    it('returns to normal when switched off', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.setArtificialLatency(600);
      put(a.doc, 'slow');
      a.provider.setArtificialLatency(0);
      // The frame already waiting still arrives, then everything is fast again.
      await until(() => b.doc.getMap(Y_KEYS.shapes).has('slow'), 5000);
      const started = performance.now();
      put(a.doc, 'fast');
      await until(() => b.doc.getMap(Y_KEYS.shapes).has('fast'), 5000);
      expect(performance.now() - started).toBeLessThan(250);
    });

    it('keeps the connection alive when a long delay is released', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.setArtificialLatency(1000);
      for (let i = 0; i < 40; i++) {
        put(a.doc, `burst${i}`);
        a.awareness.setLocalStateField('pointer', { x: i, y: i });
        await sleep(20);
      }
      a.provider.setArtificialLatency(0);
      await until(() => keys(b.doc).length === 40, 15_000);
      // The server closes a socket that exceeds its rate limit. This one must still be open.
      expect(a.provider.status).toBe('connected');
      expect(a.socket().readyState).toBe(1);
    });

    it('clamps to the maximum', async () => {
      const a = peer(ALICE);
      await ready(a);
      a.provider.setArtificialLatency(99_999);
      expect(a.provider.chaos.latencyMs).toBe(2000);
      a.provider.setArtificialLatency(-1);
      expect(a.provider.chaos.latencyMs).toBe(0);
    });
  });

  describe('simulated split-brain', () => {
    it('merges edits made on both sides while apart, with nothing lost', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      put(a.doc, 'shared-before');
      await until(() => b.doc.getMap(Y_KEYS.shapes).has('shared-before'));

      a.provider.setOffline(true);
      expect(a.provider.chaos.offline).toBe(true);
      await until(() => a.provider.status === 'disconnected');

      for (let i = 0; i < 5; i++) put(a.doc, `a-offline-${i}`);
      for (let i = 0; i < 5; i++) put(b.doc, `b-meanwhile-${i}`);
      await sleep(200);

      // Apart: neither side has the other's edits.
      expect(keys(b.doc).some((key) => key.startsWith('a-offline'))).toBe(false);
      expect(keys(a.doc).some((key) => key.startsWith('b-meanwhile'))).toBe(false);
      expect(a.provider.unsyncedBytes()).toBeGreaterThan(0);

      a.provider.setOffline(false);
      await until(() => keys(a.doc).length === 11 && keys(b.doc).length === 11, 10_000);
      expect(keys(a.doc)).toEqual(keys(b.doc));
      expect(keys(a.doc)).toContain('shared-before');
      expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).size).toBe(11);
    });

    it('merges concurrent edits to the same shape property by property', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      const shape = new Y.Map<unknown>();
      a.doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes).set('s', shape);
      await until(() => b.doc.getMap(Y_KEYS.shapes).has('s'));

      a.provider.setOffline(true);
      await until(() => a.provider.status === 'disconnected');
      (a.doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes).get('s') as Y.Map<unknown>).set('x', 10);
      (b.doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes).get('s') as Y.Map<unknown>).set('y', 20);
      await sleep(150);
      a.provider.setOffline(false);

      await until(() => {
        const mine = a.doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes).get('s')?.toJSON();
        const theirs = b.doc.getMap<Y.Map<unknown>>(Y_KEYS.shapes).get('s')?.toJSON();
        return mine?.['x'] === 10 && mine['y'] === 20 && theirs?.['x'] === 10 && theirs['y'] === 20;
      }, 10_000);
    });

    it('merges notes typed on both sides', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      const textOf = (doc: Y.Doc) => doc.getText('notes-text').toString();

      a.provider.setOffline(true);
      await until(() => a.provider.status === 'disconnected');
      a.doc.getText('notes-text').insert(0, 'from A. ');
      b.doc.getText('notes-text').insert(0, 'from B. ');
      await sleep(150);
      a.provider.setOffline(false);

      await until(() => textOf(a.doc).length === 16 && textOf(a.doc) === textOf(b.doc), 10_000);
      expect(textOf(a.doc)).toContain('from A. ');
      expect(textOf(a.doc)).toContain('from B. ');
    });

    it('reports what was exchanged when it comes back', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      const reports: { sentBytes: number; receivedBytes: number; durationMs: number }[] = [];
      a.provider.on('reconcile', (report) => reports.push(report));

      a.provider.setOffline(true);
      await until(() => a.provider.status === 'disconnected');
      put(a.doc, 'mine');
      put(b.doc, 'theirs');
      await sleep(150);
      a.provider.setOffline(false);

      await until(() => reports.length === 1, 10_000);
      expect(reports[0]?.sentBytes).toBeGreaterThan(0);
      expect(reports[0]?.receivedBytes).toBeGreaterThan(0);
      expect(reports[0]?.durationMs).toBeGreaterThanOrEqual(0);
      expect(a.provider.lastReconcile).toEqual(reports[0]);
    });

    it('makes the other side see the user leave and return', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      await until(() => b.awareness.getStates().has(a.doc.clientID));

      a.provider.setOffline(true);
      await until(() => !b.awareness.getStates().has(a.doc.clientID));
      a.provider.setOffline(false);
      await until(() => b.awareness.getStates().has(a.doc.clientID), 10_000);
    });

    it('does not let a frame delayed before going offline reach the new connection', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.setArtificialLatency(800);
      put(a.doc, 'in-flight');
      a.provider.setOffline(true);
      a.provider.setOffline(false);
      a.provider.setArtificialLatency(0);

      // The edit is not lost: the reconnect handshake carries it, once.
      await until(() => b.doc.getMap(Y_KEYS.shapes).has('in-flight'), 10_000);
      expect(a.provider.status).toBe('connected');
    });

    it('is idempotent', async () => {
      const a = peer(ALICE);
      await ready(a);
      a.provider.setOffline(true);
      a.provider.setOffline(true);
      expect(a.provider.chaos.offline).toBe(true);
      a.provider.setOffline(false);
      a.provider.setOffline(false);
      await until(() => a.provider.synced, 10_000);
    });

    it('does not turn a viewer into an editor', async () => {
      roles.set(roomId, BOB, 'VIEWER');
      const editor = peer(ALICE);
      const viewer = peer(BOB);
      await ready(editor, viewer);

      viewer.provider.setOffline(true);
      await until(() => viewer.provider.status === 'disconnected');
      put(viewer.doc, 'viewer-edit');
      viewer.provider.setOffline(false);
      await until(() => viewer.provider.synced, 10_000);
      await sleep(250);

      // The viewer's offline edit goes through the same server check as any other, and is dropped.
      expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('viewer-edit')).toBe(false);
      expect(editor.doc.getMap(Y_KEYS.shapes).has('viewer-edit')).toBe(false);
    });

    it('is not a reason for the server to end the session', async () => {
      const a = peer(ALICE);
      await ready(a);
      let terminated: number | null = null;
      a.provider.on('terminated', (code) => (terminated = code));
      a.provider.setOffline(true);
      await sleep(300);
      a.provider.setOffline(false);
      await until(() => a.provider.synced, 10_000);
      expect(terminated).toBeNull();
      expect(WS_CLOSE.KICKED).toBeGreaterThan(0);
    });
  });

  describe('traffic counters', () => {
    it('counts what crosses the wire in both directions, split into sync and presence', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      const before = { in: { ...a.provider.traffic.in }, out: { ...a.provider.traffic.out } };

      put(a.doc, 'x');
      a.awareness.setLocalStateField('pointer', { x: 1, y: 1 });
      put(b.doc, 'y');
      b.awareness.setLocalStateField('pointer', { x: 2, y: 2 });
      await until(() => a.doc.getMap(Y_KEYS.shapes).has('y') && b.doc.getMap(Y_KEYS.shapes).has('x'));
      await sleep(100);

      const { traffic } = a.provider;
      expect(traffic.out.frames).toBeGreaterThan(before.out.frames);
      expect(traffic.in.frames).toBeGreaterThan(before.in.frames);
      expect(traffic.out.sync).toBeGreaterThan(before.out.sync);
      expect(traffic.in.sync).toBeGreaterThan(before.in.sync);
      expect(traffic.out.bytes).toBeGreaterThan(before.out.bytes);
      expect(traffic.in.awareness).toBeGreaterThan(before.in.awareness);
    });

    it('counts on the wire, before any artificial delay', async () => {
      const a = peer(ALICE);
      const b = peer(BOB);
      await ready(a, b);
      a.provider.setArtificialLatency(1500);
      const before = a.provider.traffic.in.frames;
      put(b.doc, 'x');
      await sleep(300);
      // The frame has arrived on the wire, though the provider has not applied it yet.
      expect(a.provider.traffic.in.frames).toBeGreaterThan(before);
      expect(a.doc.getMap(Y_KEYS.shapes).has('x')).toBe(false);
    });
  });

  describe('a ghost is a second socket of the same user', () => {
    function ghostState(userId: string, name: string) {
      return { user: { id: userId, name, color: '#7c3aed' }, ghost: true };
    }

    it('is accepted under its own name and shows up as a separate participant', async () => {
      const real = peer(ALICE);
      const observer = peer(BOB);
      const ghost = peer(ALICE);
      await ready(real, observer, ghost);
      ghost.awareness.setLocalState(ghostState(ALICE, 'Ghost 1'));

      await until(() => {
        const state = observer.awareness.getStates().get(ghost.doc.clientID) as { ghost?: boolean; user?: { name: string } } | undefined;
        return state?.ghost === true && state.user?.name === 'Ghost 1';
      });
      expect(observer.awareness.getStates().has(real.doc.clientID)).toBe(true);
      expect(ghost.doc.clientID).not.toBe(real.doc.clientID);
    });

    it('cannot claim to be somebody else', async () => {
      const ghost = peer(ALICE);
      const observer = peer(BOB);
      await ready(ghost, observer);
      ghost.awareness.setLocalState(ghostState(BOB, 'Not Alice'));
      await sleep(250);
      const seen = observer.awareness.getStates().get(ghost.doc.clientID) as { user?: { name: string } } | undefined;
      expect(seen?.user?.name).not.toBe('Not Alice');
    });

    it('edits the room through the real server, as an editor', async () => {
      const real = peer(ALICE);
      const ghost = peer(ALICE);
      await ready(real, ghost);
      put(ghost.doc, 'ghost-sticky');
      await until(() => real.doc.getMap(Y_KEYS.shapes).has('ghost-sticky'));
    });

    it('is a viewer when its user is a viewer, so it cannot edit anything', async () => {
      roles.set(roomId, BOB, 'VIEWER');
      const editor = peer(ALICE);
      const ghost = peer(BOB);
      await ready(editor, ghost);
      ghost.awareness.setLocalState(ghostState(BOB, 'Ghost 1'));

      put(ghost.doc, 'ghost-sticky');
      await sleep(300);
      expect(editor.doc.getMap(Y_KEYS.shapes).has('ghost-sticky')).toBe(false);
      expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('ghost-sticky')).toBe(false);
    });

    it('cannot show a laser when its user is a viewer', async () => {
      roles.set(roomId, BOB, 'VIEWER');
      const editor = peer(ALICE);
      const ghost = peer(BOB);
      await ready(editor, ghost);
      ghost.awareness.setLocalState({ ...ghostState(BOB, 'Ghost 1'), laser: { x: 1, y: 1 } });
      await sleep(250);
      const seen = editor.awareness.getStates().get(ghost.doc.clientID) as { laser?: unknown } | undefined;
      expect(seen?.laser).toBeUndefined();
    });

    it('stops being able to edit the moment its user is downgraded', async () => {
      const editor = peer(BOB);
      const ghost = peer(ALICE);
      await ready(editor, ghost);
      put(ghost.doc, 'before');
      await until(() => editor.doc.getMap(Y_KEYS.shapes).has('before'));

      for (const client of server.manager.get(roomId)?.clients ?? []) if (client.data.userId === ALICE) client.setRole('VIEWER');
      put(ghost.doc, 'after');
      await sleep(300);
      expect(server.manager.get(roomId)?.doc.getMap(Y_KEYS.shapes).has('after')).toBe(false);
    });

    it('counts toward the per-user socket cap, so ghosts cannot be unlimited', async () => {
      const sockets = Array.from({ length: 8 }, () => peer(ALICE));
      await until(() => sockets.every((p) => p.provider.status === 'connected'));
      const extra = peer(ALICE);
      await sleep(500);
      expect(extra.provider.synced).toBe(false);
    });
  });
});
