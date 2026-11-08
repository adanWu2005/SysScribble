import { randomUUID } from 'node:crypto';
import {
  WS_BEARER_PREFIX,
  WS_CLOSE,
  WS_MAX_PAYLOAD_BYTES,
  WS_MAX_SOCKETS_PER_USER_PER_ROOM,
  WS_SUBPROTOCOL,
  encodeSyncStep1,
  type RoomRole,
} from '@wb/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import type { WsServer } from '../../src/server';
import {
  MemoryHub,
  MemoryRoleStore,
  MemorySnapshotStore,
  ORIGIN,
  connectPeer,
  signToken,
  sleep,
  startServer,
  until,
  type Harness,
} from '../helpers/harness';

const USER = '11111111-2222-4333-8444-555555555555';

interface Attempt {
  status: number | null;
  ws: WebSocket;
  opened: boolean;
  protocol: string;
}

async function attempt(
  port: number,
  path: string,
  options: { origin?: string | null; token?: string | null; protocols?: string[] } = {},
): Promise<Attempt> {
  const token = options.token === undefined ? await signToken(USER) : options.token;
  const protocols =
    options.protocols ?? [WS_SUBPROTOCOL, ...(token === null ? [] : [`${WS_BEARER_PREFIX}${token}`])];
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, origin === null ? {} : { origin });
  return new Promise((resolve) => {
    ws.on('error', () => undefined);
    ws.on('open', () => resolve({ status: 101, ws, opened: true, protocol: ws.protocol }));
    ws.on('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? null, ws, opened: false, protocol: '' });
      res.destroy();
    });
  });
}

describe('WebSocket upgrade gate', () => {
  let harness: Harness & { roles: MemoryRoleStore; snapshots: MemorySnapshotStore };
  let hub: MemoryHub;
  let server: WsServer;
  let port: number;
  let roomId: string;
  let path: string;

  function member(role: RoomRole | null): void {
    harness.roles.set(roomId, USER, role);
  }

  beforeEach(async () => {
    harness = { roles: new MemoryRoleStore(), snapshots: new MemorySnapshotStore() };
    hub = new MemoryHub();
    roomId = randomUUID();
    path = `/rooms/${roomId}`;
    harness.snapshots.createRoom(roomId);
    ({ server, port } = await startServer(harness, hub.bus()));
  });

  afterEach(async () => {
    await server.close();
  });

  it('admits a member and never echoes the JWT subprotocol', async () => {
    member('EDITOR');
    const result = await attempt(port, path);
    expect(result.status).toBe(101);
    expect(result.protocol).toBe(WS_SUBPROTOCOL);
    result.ws.terminate();
  });

  it('CSWSH: refuses an unknown Origin even with a valid JWT', async () => {
    member('OWNER');
    const result = await attempt(port, path, { origin: 'https://evil.example' });
    expect(result.status).toBe(403);
    expect(result.opened).toBe(false);
  });

  it('refuses a missing Origin', async () => {
    member('OWNER');
    expect((await attempt(port, path, { origin: null })).status).toBe(403);
  });

  it('refuses a missing token', async () => {
    member('OWNER');
    expect((await attempt(port, path, { token: null })).status).toBe(401);
  });

  it('refuses a forged signature', async () => {
    member('OWNER');
    const forged = await signToken(USER, '1h', 'attacker-controlled-secret-attacker-controlled');
    expect((await attempt(port, path, { token: forged })).status).toBe(401);
  });

  it('refuses an expired token', async () => {
    member('OWNER');
    const expired = await signToken(USER, '-10m');
    expect((await attempt(port, path, { token: expired })).status).toBe(401);
  });

  it('IDOR: a valid JWT for a non-member is refused', async () => {
    expect((await attempt(port, path)).status).toBe(403);
    expect(server.manager.get(roomId)).toBeUndefined();
  });

  it.each(['/', '/rooms/not-a-uuid', '/rooms/%27%20OR%201%3D1'])('refuses path %s', async (bad) => {
    member('OWNER');
    expect((await attempt(port, bad)).status).toBe(404);
  });

  it('a kicked user cannot reconnect during the ban window', async () => {
    member('EDITOR');
    hub.kicked.add(`${roomId}:${USER}`);
    expect((await attempt(port, path)).status).toBe(403);
  });

  it('caps sockets per user per room', async () => {
    member('EDITOR');
    const open: WebSocket[] = [];
    for (let i = 0; i < WS_MAX_SOCKETS_PER_USER_PER_ROOM; i++) {
      const result = await attempt(port, path);
      expect(result.status).toBe(101);
      open.push(result.ws);
    }
    expect((await attempt(port, path)).status).toBe(429);
    for (const ws of open) ws.terminate();
  });

  it('closes a socket when its JWT expires', async () => {
    member('EDITOR');
    const shortLived = await signToken(USER, '1s');
    const result = await attempt(port, path, { token: shortLived });
    const code = await new Promise<number>((resolve) => result.ws.on('close', resolve));
    expect(code).toBe(WS_CLOSE.UNAUTHORIZED);
  });

  describe('frame limits', () => {
    it('rejects a frame above maxPayload without crashing', async () => {
      member('EDITOR');
      const { ws } = await attempt(port, path);
      const closed = new Promise<number>((resolve) => ws.on('close', resolve));
      ws.send(new Uint8Array(WS_MAX_PAYLOAD_BYTES + 1));
      expect(await closed).toBe(1009);

      const again = await attempt(port, path);
      expect(again.status).toBe(101);
      again.ws.terminate();
    });

    it('disconnects a while(true) flood with 1008', async () => {
      member('VIEWER');
      const { ws } = await attempt(port, path);
      const closed = new Promise<number>((resolve) => ws.on('close', resolve));
      const frame = encodeSyncStep1(new Y.Doc());
      for (let i = 0; i < 500 && ws.readyState === WebSocket.OPEN; i++) ws.send(frame);
      expect(await closed).toBe(WS_CLOSE.POLICY_VIOLATION);
    });

    it('accepts a sustained 30 messages per second', async () => {
      member('EDITOR');
      const { ws } = await attempt(port, path);
      const frame = encodeSyncStep1(new Y.Doc());
      for (let i = 0; i < 45; i++) {
        ws.send(frame);
        await sleep(33);
      }
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.terminate();
    });

    it('closes on a text frame', async () => {
      member('EDITOR');
      const { ws } = await attempt(port, path);
      const closed = new Promise<number>((resolve) => ws.on('close', resolve));
      ws.send('{"not":"binary"}');
      expect(await closed).toBe(WS_CLOSE.POLICY_VIOLATION);
    });
  });

  describe('races around membership', () => {
    it('a downgrade during the handshake is seen at admission', async () => {
      member('EDITOR');
      harness.roles.delayMs = 30;
      const peer = connectPeer(port, roomId, USER);
      await sleep(10);
      member('VIEWER');
      harness.roles.delayMs = 0;
      await until(() => peer.provider.role !== null);
      expect(peer.provider.role).toBe('VIEWER');
      peer.destroy();
    });

    it('a removal during the handshake closes the socket', async () => {
      member('EDITOR');
      harness.roles.delayMs = 30;
      const peer = connectPeer(port, roomId, USER);
      const code = new Promise<number>((resolve) => peer.provider.on('terminated', resolve));
      await sleep(10);
      member(null);
      harness.roles.delayMs = 0;
      expect(await code).toBe(WS_CLOSE.REMOVED);
      peer.destroy();
    });

    it('revalidation corrects a role whose control event was lost', async () => {
      member('EDITOR');
      const peer = connectPeer(port, roomId, USER);
      await until(() => peer.provider.role === 'EDITOR');
      member('VIEWER');
      await server.manager.get(roomId)?.revalidateRoles();
      await until(() => peer.provider.role === 'VIEWER');
      peer.destroy();
    });
  });

  it('serves health checks without upgrading', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
  });
});
