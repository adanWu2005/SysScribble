import {
  MSG_CONTROL,
  STATS_MIN_INTERVAL_MS,
  encodeAwarenessFrame,
  encodePing,
  encodePong,
  encodeStatsRequest,
  serverControlFrameSchema,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
  type RoomRole,
} from '@wb/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as decoding from 'lib0/decoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Logger } from '../../src/logger';
import type { Client } from '../../src/room/Client';
import { handleMessage, type MessageContext } from '../../src/room/messageHandler';

const STATS = { pendingEdits: 3, lastFlushAt: 1_000, lastFlushOutcome: 'saved' as const, sockets: 2, serverTime: 5_000 };
const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const USER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

function fakeClient(role: RoomRole) {
  return {
    data: { userId: USER, role, ip: '127.0.0.1' },
    awarenessClientId: null,
    send: vi.fn(() => true),
    close: vi.fn(),
  } as unknown as Client & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

function someUpdate(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('shapes').set('a', 1);
  return Y.encodeStateAsUpdate(doc);
}

function awarenessFrame(clientId: number, state: unknown): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(state as Record<string, unknown> | null);
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId]);
  awareness.destroy();
  return encodeAwarenessFrame(update);
}

describe('handleMessage', () => {
  let ctx: MessageContext;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const doc = new Y.Doc();
    warn = vi.fn();
    ctx = {
      roomId: ROOM,
      doc,
      awareness: new awarenessProtocol.Awareness(doc),
      overQuota: false,
      log: { warn } as unknown as Logger,
      stats: () => STATS,
    };
  });

  describe('role enforcement', () => {
    it.each([
      ['SYNC_UPDATE', encodeSyncUpdate],
      ['SYNC_STEP2', encodeSyncStep2],
    ])('drops and logs a VIEWER %s frame', (_name, encode) => {
      const viewer = fakeClient('VIEWER');
      handleMessage(ctx, viewer, encode(someUpdate()));
      expect(ctx.doc.getMap('shapes').size).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'viewer_mutation_dropped', userId: USER, roomId: ROOM }),
        expect.anything(),
      );
      expect(viewer.close).not.toHaveBeenCalled();
    });

    it.each(['OWNER', 'EDITOR'] as const)('applies updates from a %s', (role) => {
      handleMessage(ctx, fakeClient(role), encodeSyncUpdate(someUpdate()));
      expect(ctx.doc.getMap('shapes').get('a')).toBe(1);
    });

    it('a VIEWER can still read through SYNC_STEP1', () => {
      ctx.doc.getMap('shapes').set('a', 1);
      const viewer = fakeClient('VIEWER');
      handleMessage(ctx, viewer, encodeSyncStep1(new Y.Doc()));
      expect(viewer.send).toHaveBeenCalledTimes(1);
    });

    it('applies a role change to the very next packet', () => {
      const client = fakeClient('EDITOR');
      client.data.role = 'VIEWER';
      handleMessage(ctx, client, encodeSyncUpdate(someUpdate()));
      expect(ctx.doc.getMap('shapes').size).toBe(0);
    });

    it('never logs payload bytes', () => {
      handleMessage(ctx, fakeClient('VIEWER'), encodeSyncUpdate(someUpdate()));
      const [fields] = warn.mock.calls[0] as [Record<string, unknown>];
      expect(Object.keys(fields).sort()).toEqual(['event', 'ip', 'roomId', 'security', 'userId']);
    });
  });

  it('refuses edits once a room is over its storage quota', () => {
    ctx.overQuota = true;
    handleMessage(ctx, fakeClient('OWNER'), encodeSyncUpdate(someUpdate()));
    expect(ctx.doc.getMap('shapes').size).toBe(0);
  });

  describe('malformed frames', () => {
    it.each([
      ['empty', new Uint8Array([])],
      ['unknown type', new Uint8Array([99])],
      ['truncated sync', new Uint8Array([0])],
      ['unknown sync subtype', new Uint8Array([0, 9, 0])],
      ['garbage update', new Uint8Array([0, 2, 3, 255, 255, 255])],
    ])('closes the socket on %s input', (_name, frame) => {
      const client = fakeClient('EDITOR');
      handleMessage(ctx, client, frame);
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('refuses trailing bytes hidden after a valid message', () => {
      const client = fakeClient('VIEWER');
      const valid = encodeSyncStep1(new Y.Doc());
      const smuggled = new Uint8Array([...valid, ...encodeSyncUpdate(someUpdate())]);
      handleMessage(ctx, client, smuggled);
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
      expect(ctx.doc.getMap('shapes').size).toBe(0);
    });
  });

  describe('awareness', () => {
    const own = { user: { id: USER, name: 'Me', color: '#112233' }, pointer: { x: 1, y: 2 } };

    it('lets a VIEWER publish a cursor', () => {
      const viewer = fakeClient('VIEWER');
      handleMessage(ctx, viewer, awarenessFrame(5, own));
      expect(ctx.awareness.getStates().get(5)).toEqual(own);
    });

    it('refuses a state that claims to be another user', () => {
      const claim = { user: { id: OTHER, name: 'Someone else', color: '#112233' } };
      handleMessage(ctx, fakeClient('EDITOR'), awarenessFrame(5, claim));
      expect(ctx.awareness.getStates().has(5)).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'awareness_spoof_dropped' }),
        expect.anything(),
      );
    });

    it('refuses overwriting or clearing a state owned by another user', () => {
      const victimState = { user: { id: OTHER, name: 'Victim', color: '#112233' } };
      const victim = fakeClient('EDITOR');
      victim.data.userId = OTHER;
      handleMessage(ctx, victim, awarenessFrame(7, victimState));

      const attacker = fakeClient('EDITOR');
      handleMessage(ctx, attacker, awarenessFrame(7, null));
      expect(ctx.awareness.getStates().get(7)).toEqual(victimState);
    });

    it('binds one socket to one awareness id', () => {
      const client = fakeClient('EDITOR');
      handleMessage(ctx, client, awarenessFrame(5, own));
      handleMessage(ctx, client, awarenessFrame(6, own));
      expect(ctx.awareness.getStates().has(6)).toBe(false);
    });

    it('refuses a state that fails the schema', () => {
      const bad = { user: { id: USER, name: 'x'.repeat(500), color: 'javascript:alert(1)' } };
      handleMessage(ctx, fakeClient('EDITOR'), awarenessFrame(5, bad));
      expect(ctx.awareness.getStates().has(5)).toBe(false);
    });

    it('closes the socket on an oversized payload', () => {
      const client = fakeClient('EDITOR');
      const huge = { user: { id: USER, name: 'Me', color: '#112233' }, blob: 'x'.repeat(10_000) };
      handleMessage(ctx, client, awarenessFrame(5, huge));
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    describe('presence fields', () => {
      const user = { id: USER, name: 'Me', color: '#112233' };

      it.each([
        ['a laser', { laser: { x: 1, y: 2 } }],
        ['a drawing indicator', { drawing: true }],
        ['both', { laser: { x: 1, y: 2 }, drawing: true }],
      ])('drops a VIEWER frame carrying %s and logs it', (_name, extra) => {
        const viewer = fakeClient('VIEWER');
        handleMessage(ctx, viewer, awarenessFrame(5, { user, ...extra }));
        expect(ctx.awareness.getStates().has(5)).toBe(false);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: 'viewer_awareness_dropped', userId: USER, roomId: ROOM }),
          expect.anything(),
        );
        // The socket stays open: a dropped frame is not a protocol error.
        expect(viewer.close).not.toHaveBeenCalled();
      });

      it('does not bind a viewer to an awareness id through a dropped frame', () => {
        const viewer = fakeClient('VIEWER');
        handleMessage(ctx, viewer, awarenessFrame(5, { user, laser: { x: 1, y: 2 } }));
        expect(viewer.awarenessClientId).toBeNull();
      });

      it('lets a VIEWER publish a cursor, a viewport and a selection', () => {
        const state = {
          user,
          pointer: { x: 1, y: 2 },
          viewport: { cx: 10, cy: 20, scale: 1.5 },
          selection: ['shape-a', 'shape-b'],
        };
        handleMessage(ctx, fakeClient('VIEWER'), awarenessFrame(5, state));
        expect(ctx.awareness.getStates().get(5)).toEqual(state);
      });

      it('lets a viewer switch the fields off, as a downgraded editor must', () => {
        handleMessage(ctx, fakeClient('VIEWER'), awarenessFrame(5, { user, laser: null, drawing: false }));
        expect(ctx.awareness.getStates().has(5)).toBe(true);
        expect(warn).not.toHaveBeenCalled();
      });

      it.each(['OWNER', 'EDITOR'] as const)('lets a %s publish a laser', (role) => {
        const state = { user, laser: { x: 3, y: 4 } };
        handleMessage(ctx, fakeClient(role), awarenessFrame(5, state));
        expect(ctx.awareness.getStates().get(5)).toEqual(state);
      });

      it('applies a downgrade to the very next awareness frame', () => {
        const client = fakeClient('EDITOR');
        handleMessage(ctx, client, awarenessFrame(5, { user, laser: { x: 1, y: 1 } }));
        client.data.role = 'VIEWER';
        handleMessage(ctx, client, awarenessFrame(5, { user, laser: { x: 9, y: 9 } }));
        expect(ctx.awareness.getStates().get(5)).toEqual({ user, laser: { x: 1, y: 1 } });
      });

      it.each([
        ['a laser with a non-numeric point', { laser: { x: 'a', y: 1 } }],
        ['a viewport with an absurd zoom', { viewport: { cx: 0, cy: 0, scale: 9999 } }],
        ['a selection that is too long', { selection: Array.from({ length: 65 }, (_, i) => `s${i}`) }],
      ])('refuses an editor frame with %s', (_name, extra) => {
        handleMessage(ctx, fakeClient('EDITOR'), awarenessFrame(5, { user, ...extra }));
        expect(ctx.awareness.getStates().has(5)).toBe(false);
      });
    });
  });

  describe('room stats request', () => {
    function reply(client: ReturnType<typeof fakeClient>): unknown {
      const frame = client.send.mock.calls[0]?.[0] as Uint8Array | undefined;
      if (!frame) return undefined;
      const decoder = decoding.createDecoder(frame);
      expect(decoding.readVarUint(decoder)).toBe(MSG_CONTROL);
      return JSON.parse(decoding.readVarString(decoder));
    }

    it.each(['VIEWER', 'EDITOR', 'OWNER'] as const)('answers a %s with the numbers and nothing else', (role) => {
      const client = fakeClient(role);
      handleMessage(ctx, client, encodeStatsRequest());
      const body = reply(client);
      expect(serverControlFrameSchema.safeParse(body).success).toBe(true);
      expect(body).toEqual({ type: 'ROOM_STATS', ...STATS });
      expect(client.close).not.toHaveBeenCalled();
    });

    it('reveals no user id, no role and nothing from the document', () => {
      const client = fakeClient('VIEWER');
      handleMessage(ctx, client, encodeStatsRequest());
      const text = JSON.stringify(reply(client));
      expect(text).not.toContain(USER);
      expect(text).not.toMatch(/role|userId|email|shapes|notes/i);
    });

    it('does not touch the document, the awareness states or the log', () => {
      const before = new Map(ctx.awareness.getStates());
      handleMessage(ctx, fakeClient('VIEWER'), encodeStatsRequest());
      expect(ctx.doc.getMap('shapes').size).toBe(0);
      expect(ctx.awareness.getStates()).toEqual(before);
      expect(warn).not.toHaveBeenCalled();
    });

    it('ignores a request that follows another too closely, without closing the socket', () => {
      const client = fakeClient('EDITOR');
      handleMessage(ctx, client, encodeStatsRequest());
      handleMessage(ctx, client, encodeStatsRequest());
      handleMessage(ctx, client, encodeStatsRequest());
      expect(client.send).toHaveBeenCalledTimes(1);
      expect(client.close).not.toHaveBeenCalled();
    });

    it('answers again once the interval has passed', () => {
      vi.useFakeTimers();
      try {
        const client = fakeClient('EDITOR');
        handleMessage(ctx, client, encodeStatsRequest());
        vi.advanceTimersByTime(STATS_MIN_INTERVAL_MS + 1);
        handleMessage(ctx, client, encodeStatsRequest());
        expect(client.send).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the throttle per socket, so one noisy socket cannot silence another', () => {
      const noisy = fakeClient('EDITOR');
      const quiet = fakeClient('VIEWER');
      handleMessage(ctx, noisy, encodeStatsRequest());
      handleMessage(ctx, quiet, encodeStatsRequest());
      expect(quiet.send).toHaveBeenCalledTimes(1);
    });

    it('closes the socket on a request with trailing bytes', () => {
      const client = fakeClient('EDITOR');
      handleMessage(ctx, client, new Uint8Array([...encodeStatsRequest(), 9]));
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
    });
  });

  describe('latency probe', () => {
    it.each(['VIEWER', 'EDITOR', 'OWNER'] as const)('answers a %s ping with the same nonce', (role) => {
      const client = fakeClient(role);
      handleMessage(ctx, client, encodePing(12345));
      expect(client.send).toHaveBeenCalledWith(encodePong(12345));
      expect(client.close).not.toHaveBeenCalled();
    });

    it('does not touch the document or the awareness states', () => {
      const statesBefore = new Map(ctx.awareness.getStates());
      handleMessage(ctx, fakeClient('VIEWER'), encodePing(1));
      expect(ctx.doc.getMap('shapes').size).toBe(0);
      expect(ctx.awareness.getStates()).toEqual(statesBefore);
    });

    it('closes the socket on a ping with trailing bytes', () => {
      const client = fakeClient('EDITOR');
      handleMessage(ctx, client, new Uint8Array([...encodePing(1), 7]));
      expect(client.close).toHaveBeenCalledWith(1008, expect.any(String));
    });
  });
});
