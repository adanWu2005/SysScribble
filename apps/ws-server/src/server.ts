import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  WS_CLOSE,
  WS_HEARTBEAT_MS,
  WS_MAX_PAYLOAD_BYTES,
  WS_MAX_PENDING_FRAMES,
  WS_MAX_SOCKETS_PER_USER_PER_ROOM,
  WS_SUBPROTOCOL,
  type RoomRole,
} from '@wb/shared';
import type { JwtVerifier, VerifiedUser } from '@wb/shared/server';
import { WebSocketServer, type WebSocket } from 'ws';
import { clientIp, extractToken, isAllowedOrigin, parseRoomPath } from './auth/handshake';
import { securityEvent, type Logger } from './logger';
import type { RoleStore, SnapshotStore } from './persistence/stores';
import type { Bus } from './redis/bus';
import { Client } from './room/Client';
import { newInstanceId } from './room/Room';
import { RoomManager } from './room/RoomManager';

export interface WsServerDeps {
  allowedOrigins: readonly string[];
  verifyJwt: JwtVerifier;
  bus: Bus;
  snapshots: SnapshotStore;
  roles: RoleStore;
  log: Logger;
  flush?: { debounceMs?: number; maxWaitMs?: number };
  evictGraceMs?: number;
}

export interface WsServer {
  http: Server;
  manager: RoomManager;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

interface Admitted {
  roomId: string;
  user: VerifiedUser;
  role: RoomRole;
}

/** Answers on the raw socket before any WebSocket exists, then destroys it. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createWsServer(deps: WsServerDeps): WsServer {
  const { log } = deps;
  const allowed = new Set(deps.allowedOrigins);
  const manager = new RoomManager({
    bus: deps.bus,
    snapshots: deps.snapshots,
    roles: deps.roles,
    log,
    instanceId: newInstanceId(),
    ...(deps.flush ? { flush: deps.flush } : {}),
    ...(deps.evictGraceMs !== undefined ? { evictGraceMs: deps.evictGraceMs } : {}),
  });

  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
    // Compression invites zip bombs and costs CPU per socket. Yjs updates are already compact.
    perMessageDeflate: false,
    // Only ever echo our own protocol, never the entry carrying the JWT.
    handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
  });

  /** The full gate (PRD §5.4). Null means the socket has already been refused. */
  async function authorize(req: IncomingMessage, socket: Duplex): Promise<Admitted | null> {
    const ip = clientIp(req);

    if (!isAllowedOrigin(req.headers.origin, allowed)) {
      securityEvent(log, 'origin_rejected', { ip });
      refuse(socket, 403, 'Forbidden');
      return null;
    }

    const roomId = parseRoomPath(req.url);
    if (!roomId) {
      securityEvent(log, 'bad_room_path', { ip });
      refuse(socket, 404, 'Not Found');
      return null;
    }

    const token = extractToken(req.headers['sec-websocket-protocol']);
    let user: VerifiedUser;
    try {
      if (!token) throw new Error('missing token');
      user = await deps.verifyJwt(token);
    } catch {
      securityEvent(log, 'jwt_rejected', { ip, roomId });
      refuse(socket, 401, 'Unauthorized');
      return null;
    }

    const role = await deps.roles.resolveRole(roomId, user.userId);
    if (role === null) {
      securityEvent(log, 'not_a_member', { ip, roomId, userId: user.userId });
      refuse(socket, 403, 'Forbidden');
      return null;
    }

    if (await deps.bus.isKicked(roomId, user.userId)) {
      securityEvent(log, 'kicked_user_reconnect', { ip, roomId, userId: user.userId });
      refuse(socket, 403, 'Forbidden');
      return null;
    }

    const room = manager.get(roomId);
    if (room && room.socketCountFor(user.userId) >= WS_MAX_SOCKETS_PER_USER_PER_ROOM) {
      securityEvent(log, 'too_many_sockets', { ip, roomId, userId: user.userId });
      refuse(socket, 429, 'Too Many Requests');
      return null;
    }

    return { roomId, user, role };
  }

  function onConnection(ws: WebSocket, req: IncomingMessage, admitted: Admitted): void {
    const { roomId, user, role } = admitted;
    const client = new Client(ws, { userId: user.userId, role, ip: clientIp(req) });
    const room = manager.acquire(roomId);
    room.addClient(client);

    // A socket must not outlive its JWT. The client reconnects with a refreshed token.
    const msUntilExpiry = user.expiresAt * 1000 - Date.now();
    client.expiryTimer = setTimeout(
      () => client.close(WS_CLOSE.UNAUTHORIZED, 'Session expired'),
      Math.max(0, msUntilExpiry),
    );
    client.expiryTimer.unref();

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (client.closed) return;
      // The limit runs first so a flood is cut off before any decoding work.
      if (!client.bucket.take()) {
        securityEvent(log, 'rate_limited', { userId: user.userId, roomId, ip: client.data.ip });
        client.close(WS_CLOSE.POLICY_VIOLATION, 'Rate limit exceeded');
        return;
      }
      if (!isBinary) {
        securityEvent(log, 'malformed_frame', { userId: user.userId, roomId, ip: client.data.ip });
        client.close(WS_CLOSE.POLICY_VIOLATION, 'Binary frames only');
        return;
      }
      const frame = new Uint8Array(data);
      if (client.ready) {
        room.receive(client, frame);
      } else if (client.pending.length < WS_MAX_PENDING_FRAMES) {
        client.pending.push(frame);
      } else {
        client.close(WS_CLOSE.POLICY_VIOLATION, 'Too many frames during load');
      }
    });

    ws.on('close', () => {
      client.closed = true;
      if (client.expiryTimer) clearTimeout(client.expiryTimer);
      room.removeClient(client);
    });

    // An oversized frame surfaces here; `ws` closes the socket with 1009 itself.
    ws.on('error', (err) => log.debug({ err: err.message, roomId }, 'socket error'));

    room.admit(client).catch((err: unknown) => {
      log.error({ roomId, err: err instanceof Error ? err.message : err }, 'admit failed');
      client.close(WS_CLOSE.SERVER_SHUTDOWN, 'Could not join room');
    });
  }

  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    authorize(req, socket)
      .then((admitted) => {
        if (!admitted) return;
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, admitted));
      })
      .catch((err: unknown) => {
        log.error({ err: err instanceof Error ? err.message : err }, 'upgrade failed');
        refuse(socket, 500, 'Internal Server Error');
      });
  });

  // Finds sockets whose peer vanished without a close frame.
  const clientOf = new WeakMap<WebSocket, { alive: boolean }>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const state = clientOf.get(ws) ?? { alive: true };
      clientOf.set(ws, state);
      if (!state.alive) {
        ws.terminate();
        continue;
      }
      state.alive = false;
      ws.ping();
    }
  }, WS_HEARTBEAT_MS);
  heartbeat.unref();
  wss.on('connection', (ws) => {
    const state = { alive: true };
    clientOf.set(ws, state);
    ws.on('pong', () => {
      state.alive = true;
    });
  });

  return {
    http,
    manager,
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve) => {
        http.listen(port, host, () => {
          const address = http.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      await manager.shutdown();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await deps.bus.close();
    },
  };
}
