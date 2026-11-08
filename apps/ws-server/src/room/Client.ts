import { WS_MAX_BUFFERED_BYTES, WS_SOCKET_BURST, WS_SOCKET_MSGS_PER_SEC, type RoomRole } from '@wb/shared';
import type { WebSocket } from 'ws';
import { TokenBucket } from '../limits/TokenBucket';

const OPEN = 1;

export interface ClientData {
  userId: string;
  role: RoomRole;
  ip: string | undefined;
}

/** One authenticated socket. `data.role` is what every packet is checked against (PRD §5.3). */
export class Client {
  readonly bucket = new TokenBucket(WS_SOCKET_BURST, WS_SOCKET_MSGS_PER_SEC);
  /** Bumped by every control event, so a slow role re-read cannot overwrite a newer decision. */
  roleEpoch = 0;
  /** A socket may speak for exactly one awareness client id. */
  awarenessClientId: number | null = null;
  closed = false;
  /** When this socket last asked for room stats, to ignore a flood of requests. */
  lastStatsAt = 0;
  /** False until the room has loaded and the role has been re-read. */
  ready = false;
  pending: Uint8Array[] = [];
  expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly ws: WebSocket,
    readonly data: ClientData,
  ) {}

  setRole(role: RoomRole): void {
    this.data.role = role;
    this.roleEpoch += 1;
  }

  /** Returns false when the peer has stopped draining its socket. */
  send(frame: Uint8Array): boolean {
    if (this.closed || this.ws.readyState !== OPEN) return true;
    if (this.ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) return false;
    this.ws.send(frame, { binary: true });
    return true;
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.ws.close(code, reason);
  }
}
