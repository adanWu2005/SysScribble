import * as decoding from 'lib0/decoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { AWARENESS_THROTTLE_MS, CHAOS_OUTBOUND_GAP_MS, DOC_SEND_INTERVAL_MS, PING_INTERVAL_MS } from '../limits';
import {
  MSG_AWARENESS,
  MSG_CONTROL,
  MSG_PONG,
  MSG_QUERY_AWARENESS,
  MSG_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  WS_BEARER_PREFIX,
  WS_CLOSE,
  WS_SUBPROTOCOL,
  serverControlFrameSchema,
  type RoomStats,
} from '../messages';
import {
  encodeAwarenessFrame,
  encodePing,
  encodeStatsRequest,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
} from '../protocol';
import { canMutate, type RoomRole } from '../roles';
import {
  DelayQueue,
  NO_CHAOS,
  clampLatency,
  countFrame,
  emptyCounter,
  type ChaosState,
  type ReconcileReport,
  type TrafficCounters,
} from './chaos';

/** The subset of WebSocket this provider uses, satisfied by the browser global and by `ws`. */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: never) => void) | null;
  onmessage: ((event: never) => void) | null;
  onclose: ((event: never) => void) | null;
  onerror: ((event: never) => void) | null;
}

export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected' | 'closed';

export interface ProviderEvents {
  status: ProviderStatus;
  role: RoomRole;
  synced: boolean;
  /** Round-trip time to the server in ms, or null while offline or before the first reply. */
  latency: number | null;
  /** Fresh server-side numbers, answering `requestStats()`. */
  stats: RoomStats;
  /** The Chaos Lab changed the artificial latency or the simulated offline state. */
  chaos: ChaosState;
  /** A connection held offline on purpose came back and exchanged its differences. */
  reconcile: ReconcileReport;
  /** The server refused this session for good; the code says why. */
  terminated: number;
}

/** A frame together with the socket it belongs to, so a delayed frame never reaches a newer socket. */
interface Tagged {
  socket: SocketLike;
  data: Uint8Array;
}

export interface RoomProviderOptions {
  /** Base URL, for example ws://localhost:4001 */
  url: string;
  roomId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** Called before every connection attempt, so a refreshed JWT is always used. */
  getToken: () => Promise<string>;
  createSocket: SocketFactory;
  /** Defaults to connecting immediately. */
  connect?: boolean;
}

const OPEN = 1;
const MAX_BACKOFF_MS = 30_000;
const MAX_FAILED_ATTEMPTS = 10;

/** These close codes are final decisions by the server, so reconnecting would be wrong. */
const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  WS_CLOSE.FORBIDDEN,
  WS_CLOSE.REMOVED,
  WS_CLOSE.ROOM_DELETED,
  WS_CLOSE.KICKED,
]);

type Listener<K extends keyof ProviderEvents> = (value: ProviderEvents[K]) => void;

/**
 * Binds a Y.Doc and Awareness to the room WebSocket server.
 *
 * The role is only ever a UI and traffic hint here. The server enforces it per packet,
 * so nothing in this class is a security control.
 */
export class RoomProvider {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  status: ProviderStatus = 'disconnected';
  role: RoomRole | null = null;
  synced = false;
  latency: number | null = null;
  /** The newest server-side numbers received, or null before the first answer. */
  roomStats: RoomStats | null = null;
  /** Replaced, never mutated, whenever it changes, so a UI can compare by identity. */
  chaos: ChaosState = NO_CHAOS;
  lastReconcile: ReconcileReport | null = null;
  /** Running totals of what crossed the wire, before any artificial delay. */
  readonly traffic: TrafficCounters = { in: emptyCounter(), out: emptyCounter() };

  private readonly opts: RoomProviderOptions;
  private readonly outQueue = new DelayQueue<Tagged>({
    deliver: ({ socket, data }) => {
      if (socket === this.socket && socket.readyState === OPEN) this.rawSend(socket, data);
    },
    minGapMs: CHAOS_OUTBOUND_GAP_MS,
  });
  private readonly inQueue = new DelayQueue<Tagged>({
    deliver: ({ socket, data }) => {
      if (socket === this.socket) this.onMessage(data);
    },
  });
  private offlineBase: Uint8Array | null = null;
  private reconcileFrom: { sentBytes: number; startedAt: number } | null = null;
  private socket: SocketLike | null = null;
  private shouldConnect = false;
  private attempts = 0;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAwarenessSentAt = 0;
  private outgoing: Uint8Array[] = [];
  private docTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDocSentAt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingNonce = 0;
  private pingSentAt = new Map<number, number>();
  private readonly listeners: { [K in keyof ProviderEvents]: Set<Listener<K>> } = {
    status: new Set(),
    role: new Set(),
    synced: new Set(),
    latency: new Set(),
    stats: new Set(),
    chaos: new Set(),
    reconcile: new Set(),
    terminated: new Set(),
  };

  constructor(opts: RoomProviderOptions) {
    this.opts = opts;
    this.doc = opts.doc;
    this.awareness = opts.awareness;
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    if (opts.connect !== false) this.connect();
  }

  on<K extends keyof ProviderEvents>(event: K, listener: Listener<K>): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  connect(): void {
    this.shouldConnect = true;
    this.attempts = 0;
    void this.open();
  }

  /** Goes offline but keeps the document, so local edits sync on the next connect(). */
  disconnect(): void {
    this.shouldConnect = false;
    this.clearReconnect();
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.handleOffline();
  }

  destroy(): void {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.disconnect();
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    if (this.docTimer) clearTimeout(this.docTimer);
    this.stopPinging();
    this.outQueue.clear();
    this.inQueue.clear();
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.setStatus('closed');
  }

  private emit<K extends keyof ProviderEvents>(event: K, value: ProviderEvents[K]): void {
    for (const listener of this.listeners[event]) listener(value);
  }

  private setStatus(status: ProviderStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  private setSynced(synced: boolean): void {
    if (this.synced === synced) return;
    this.synced = synced;
    this.emit('synced', synced);
  }

  private async open(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.setStatus('connecting');

    let token: string;
    try {
      token = await this.opts.getToken();
    } catch {
      if (generation === this.generation) this.scheduleReconnect();
      return;
    }
    if (generation !== this.generation || !this.shouldConnect) return;

    const url = `${this.opts.url.replace(/\/+$/, '')}/rooms/${this.opts.roomId}`;
    // The JWT travels as a subprotocol so it never appears in a URL or an access log.
    const socket = this.opts.createSocket(url, [WS_SUBPROTOCOL, `${WS_BEARER_PREFIX}${token}`]);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = (() => {
      if (socket !== this.socket) return;
      this.attempts = 0;
      this.setStatus('connected');
      this.startPinging();
      this.send(encodeSyncStep1(this.doc));
      const local = this.awareness.getLocalState();
      if (local !== null) {
        // When a socket drops, the server clears this user's presence and moves its clock for
        // them past ours. Sending our old state again would be ignored as stale, and an idle user
        // would stay invisible to everyone until the mouse moved. Setting the state again bumps
        // our clock, and the throttled sender forwards it.
        this.awareness.setLocalState(local);
      }
    }) as never;

    socket.onmessage = ((event: { data: unknown }) => {
      if (socket !== this.socket) return;
      let data: Uint8Array;
      if (event.data instanceof ArrayBuffer) data = new Uint8Array(event.data);
      else if (event.data instanceof Uint8Array) data = event.data;
      else return;
      countFrame(this.traffic.in, data);
      // With no artificial delay a frame goes straight in, unless delayed frames are still
      // waiting ahead of it, which it must not overtake.
      if (this.chaos.latencyMs === 0 && this.inQueue.idle) this.onMessage(data);
      else this.inQueue.push({ socket, data });
    }) as never;

    socket.onclose = ((event: { code: number }) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.handleOffline();
      if (TERMINAL_CLOSE_CODES.has(event.code)) {
        this.shouldConnect = false;
        this.emit('terminated', event.code);
        return;
      }
      this.scheduleReconnect();
    }) as never;

    socket.onerror = (() => undefined) as never;
  }

  private handleOffline(): void {
    this.stopPinging();
    this.setLatency(null);
    this.setStatus('disconnected');
    this.setSynced(false);
    this.role = null;
    const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID);
    awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
  }

  private setLatency(latency: number | null): void {
    if (this.latency === latency) return;
    this.latency = latency;
    this.emit('latency', latency);
  }

  private startPinging(): void {
    this.stopPinging();
    this.sendPing();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pingSentAt.clear();
  }

  private sendPing(): void {
    this.pingNonce += 1;
    // Only the last few probes are remembered, so a server that never answers cannot grow this.
    if (this.pingSentAt.size >= 4) this.pingSentAt.clear();
    this.pingSentAt.set(this.pingNonce, performance.now());
    this.send(encodePing(this.pingNonce));
  }

  private onPong(nonce: number): void {
    const sentAt = this.pingSentAt.get(nonce);
    if (sentAt === undefined) return;
    this.pingSentAt.delete(nonce);
    const sample = performance.now() - sentAt;
    // A light average keeps the readout from flickering on one slow packet.
    this.setLatency(Math.round(this.latency === null ? sample : this.latency * 0.6 + sample * 0.4));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect) return;
    this.attempts += 1;
    if (this.attempts > MAX_FAILED_ATTEMPTS) {
      // A rejected upgrade looks like a network failure in the browser, so give up eventually.
      this.shouldConnect = false;
      this.emit('terminated', WS_CLOSE.UNAUTHORIZED);
      return;
    }
    const delay = Math.min(MAX_BACKOFF_MS, 250 * 2 ** this.attempts);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => void this.open(), delay / 2 + Math.random() * (delay / 2));
  }

  private send(data: Uint8Array): void {
    const socket = this.socket;
    if (socket?.readyState !== OPEN) return;
    if (this.chaos.latencyMs === 0 && this.outQueue.idle) this.rawSend(socket, data);
    else this.outQueue.push({ socket, data });
  }

  private rawSend(socket: SocketLike, data: Uint8Array): void {
    countFrame(this.traffic.out, data);
    socket.send(data);
  }

  // ---- Chaos Lab: conditions a developer imposes on their own connection ----

  private setChaos(next: ChaosState): void {
    if (next.latencyMs === this.chaos.latencyMs && next.offline === this.chaos.offline) return;
    this.chaos = next;
    this.emit('chaos', next);
  }

  /** Adds this much delay to every frame in each direction. 0 turns it off. */
  setArtificialLatency(ms: number): void {
    const latencyMs = clampLatency(ms);
    this.outQueue.setLatency(latencyMs);
    this.inQueue.setLatency(latencyMs);
    this.setChaos({ ...this.chaos, latencyMs });
  }

  /**
   * Holds the connection offline on purpose while the document stays editable. Going back online
   * runs the ordinary reconnect handshake: both sides send what the other is missing, which is
   * the state-vector exchange a real network partition would end with.
   */
  setOffline(offline: boolean): void {
    if (offline === this.chaos.offline) return;
    if (offline) {
      this.offlineBase = Y.encodeStateVector(this.doc);
      this.reconcileFrom = null;
      // Frames in flight are lost, as they would be on a dead connection.
      this.outQueue.clear();
      this.inQueue.clear();
      this.setChaos({ ...this.chaos, offline: true });
      this.disconnect();
      return;
    }
    const base = this.offlineBase;
    this.offlineBase = null;
    this.reconcileFrom = {
      sentBytes: base ? Y.encodeStateAsUpdate(this.doc, base).byteLength : 0,
      startedAt: performance.now(),
    };
    this.setChaos({ ...this.chaos, offline: false });
    this.connect();
  }

  /** Size of the edits made since the connection was held offline, not yet sent. 0 otherwise. */
  unsyncedBytes(): number {
    return this.offlineBase ? Y.encodeStateAsUpdate(this.doc, this.offlineBase).byteLength : 0;
  }

  /** Asks the server for its numbers. The answer arrives as a `stats` event. */
  requestStats(): void {
    this.send(encodeStatsRequest());
  }

  private onMessage(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    try {
      const type = decoding.readVarUint(decoder);
      switch (type) {
        case MSG_SYNC:
          this.onSync(decoder);
          break;
        case MSG_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
          break;
        case MSG_PONG:
          this.onPong(decoding.readVarUint(decoder));
          break;
        case MSG_QUERY_AWARENESS:
          this.send(
            encodeAwarenessFrame(
              awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
            ),
          );
          break;
        case MSG_CONTROL: {
          const control = serverControlFrameSchema.safeParse(JSON.parse(decoding.readVarString(decoder)));
          if (control.success) {
            const frame = control.data;
            if (frame.type === 'ROOM_STATS') {
              const { type: _type, ...stats } = frame;
              this.roomStats = stats;
              this.emit('stats', stats);
            } else {
              this.role = frame.role;
              this.emit('role', frame.role);
            }
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('[RoomProvider] dropped a malformed frame', err instanceof Error ? err.message : err);
    }
  }

  private onSync(decoder: decoding.Decoder): void {
    const subtype = decoding.readVarUint(decoder);
    const payload = decoding.readVarUint8Array(decoder);
    switch (subtype) {
      case SYNC_STEP1:
        // The server wants what it is missing. Offline edits go out through this reply.
        if (this.role && canMutate(this.role)) {
          this.send(encodeSyncStep2(Y.encodeStateAsUpdate(this.doc, payload)));
        }
        break;
      case SYNC_STEP2: {
        Y.applyUpdate(this.doc, payload, this);
        this.setSynced(true);
        const pending = this.reconcileFrom;
        if (pending) {
          this.reconcileFrom = null;
          const report: ReconcileReport = {
            sentBytes: pending.sentBytes,
            receivedBytes: payload.byteLength,
            durationMs: Math.round(performance.now() - pending.startedAt),
          };
          this.lastReconcile = report;
          this.emit('reconcile', report);
        }
        break;
      }
      case SYNC_UPDATE:
        Y.applyUpdate(this.doc, payload, this);
        break;
      default:
        break;
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;
    if (!this.role || !canMutate(this.role)) return;
    // Konva drags fire at display rate. Sending each one, plus cursors, would pass the
    // server's per-socket limit, so the first edit goes now and the rest are merged.
    this.outgoing.push(update);
    if (this.docTimer) return;
    const wait = DOC_SEND_INTERVAL_MS - (Date.now() - this.lastDocSentAt);
    if (wait <= 0) this.flushOutgoing();
    else this.docTimer = setTimeout(this.flushOutgoing, wait);
  };

  private readonly flushOutgoing = (): void => {
    this.docTimer = null;
    if (this.outgoing.length === 0) return;
    const merged = Y.mergeUpdates(this.outgoing);
    this.outgoing = [];
    this.lastDocSentAt = Date.now();
    // While offline this is a no-op: the sync handshake on reconnect resends the edits.
    this.send(encodeSyncUpdate(merged));
  };

  private readonly onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this) return;
    const id = this.doc.clientID;
    if (![...change.added, ...change.updated, ...change.removed].includes(id)) return;

    if (this.awarenessTimer) return;
    const wait = Math.max(0, AWARENESS_THROTTLE_MS - (Date.now() - this.lastAwarenessSentAt));
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null;
      this.lastAwarenessSentAt = Date.now();
      this.send(encodeAwarenessFrame(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [id])));
    }, wait);
  };
}
