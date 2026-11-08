import { randomUUID } from 'node:crypto';
import {
  ANTI_ENTROPY_MS,
  PRESENCE_REFRESH_MS,
  AWARENESS_PROBE_MS,
  FLUSH_DEBOUNCE_MS,
  FLUSH_LOCK_TTL_MS,
  FLUSH_MAX_WAIT_MS,
  MAX_SNAPSHOT_BYTES,
  REDIS_COALESCE_MS,
  ROLE_REVALIDATE_MS,
  WS_CLOSE,
  canMutate,
  controlEventSchema,
  encodeAwarenessFrame,
  encodeControlFrame,
  encodeSyncStep1,
  encodeSyncUpdate,
  flushLockKey,
  type RoomStats,
} from '@wb/shared';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { securityEvent, type Logger } from '../logger';
import { FlushScheduler, type FlushOutcome } from '../persistence/FlushScheduler';
import type { RoleStore, SnapshotStore } from '../persistence/stores';
import type { Bus } from '../redis/bus';
import { BUS_AWARENESS, BUS_STATE_VECTOR, BUS_UPDATE, decodeBusFrame, encodeBusFrame } from '../redis/wire';
import type { Client } from './Client';
import { handleMessage, type MessageContext } from './messageHandler';

/** Update came from another instance: already on the bus, so do not republish it. */
const BUS_ORIGIN = Symbol('bus');
/** Update came from Postgres: already stored, so it does not make the room dirty. */
const PERSIST_ORIGIN = Symbol('persist');

const EMPTY_UPDATE_LENGTH = 2;

export interface RoomDeps {
  bus: Bus;
  snapshots: SnapshotStore;
  roles: RoleStore;
  log: Logger;
  instanceId: string;
  onEmpty: (room: Room) => void;
  flush?: { debounceMs?: number; maxWaitMs?: number };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** True when `mine` already contains everything in `theirs`. */
function covers(mine: Map<number, number>, theirs: Map<number, number>): boolean {
  for (const [client, clock] of theirs) {
    if ((mine.get(client) ?? 0) < clock) return false;
  }
  return true;
}

/** One live document on this instance, plus the sockets connected to it here. */
export class Room implements MessageContext {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly clients = new Set<Client>();
  readonly scheduler: FlushScheduler;
  readonly ready: Promise<void>;
  readonly log: Logger;
  overQuota = false;
  destroyed = false;

  private deleted = false;
  private version = 0;
  private outUpdates: Uint8Array[] = [];
  private outAwareness = new Set<number>();
  private outTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessMutedUntil = 0;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private lastPresence = 0;

  constructor(
    readonly roomId: string,
    private readonly deps: RoomDeps,
  ) {
    this.log = deps.log.child({ roomId });
    this.awareness.setLocalState(null);
    this.scheduler = new FlushScheduler(() => this.persist(), {
      debounceMs: deps.flush?.debounceMs ?? FLUSH_DEBOUNCE_MS,
      maxWaitMs: deps.flush?.maxWaitMs ?? FLUSH_MAX_WAIT_MS,
      onError: (err) => this.log.error({ err: err instanceof Error ? err.message : err }, 'snapshot flush failed'),
    });
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    // Subscribe first: edits published while we read Postgres must not fall in a gap.
    await this.deps.bus.subscribeRoom(this.roomId, {
      onSync: (frame) => this.onBusFrame(frame),
      onControl: (json) => this.onControl(json),
    });
    const snapshot = await this.deps.snapshots.load(this.roomId);
    if (!snapshot) {
      this.onRoomDeleted();
      return;
    }
    this.version = snapshot.version;
    if (snapshot.bytes) Y.applyUpdate(this.doc, snapshot.bytes, PERSIST_ORIGIN);

    // Pub/Sub only delivers future messages, so ask peers for edits not yet in Postgres.
    this.publishStateVector();
    this.timers.push(setInterval(() => this.publishStateVector(), ANTI_ENTROPY_MS));
    this.timers.push(setInterval(() => void this.revalidateRoles(), ROLE_REVALIDATE_MS));
    // Rewritten while people are here, so the web app can tell a live count from a stale one.
    this.timers.push(setInterval(() => this.clients.size > 0 && this.publishPresence(true), PRESENCE_REFRESH_MS));
    for (const timer of this.timers) timer.unref();
  }

  /** Runs after `addClient`, so control events can already reach this socket. */
  async admit(client: Client): Promise<void> {
    await this.ready;
    if (client.closed) return;

    // Closes the handshake race: a downgrade committed between the first role check and
    // addClient() produced an event nobody received, but it is visible here.
    const epoch = client.roleEpoch;
    const role = await this.deps.roles.resolveRole(this.roomId, client.data.userId);
    if (client.closed) return;
    if (role === null) {
      client.close(WS_CLOSE.REMOVED, 'Not a member');
      return;
    }
    if (client.roleEpoch === epoch) client.data.role = role;

    client.send(
      encodeControlFrame({ type: 'SESSION', role: client.data.role, userId: client.data.userId }),
    );
    if (canMutate(client.data.role)) client.send(encodeSyncStep1(this.doc));

    const ids = Array.from(this.awareness.getStates().keys());
    if (ids.length > 0) {
      client.send(encodeAwarenessFrame(awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids)));
    }

    client.ready = true;
    const pending = client.pending;
    client.pending = [];
    for (const frame of pending) this.receive(client, frame);
  }

  addClient(client: Client): void {
    this.clients.add(client);
    this.publishPresence(false);
  }

  /** How many different people are connected here. A second tab, or a ghost, is the same person. */
  private distinctUsers(): number {
    return new Set(Array.from(this.clients, (client) => client.data.userId)).size;
  }

  /** Tells the dashboard how many people are in this room. Skips a write when nothing changed, unless forced. */
  private publishPresence(force: boolean): void {
    if (this.destroyed) return;
    const users = this.distinctUsers();
    if (!force && users === this.lastPresence) return;
    this.lastPresence = users;
    void this.deps.bus.setPresence(this.roomId, this.deps.instanceId, users);
  }

  /** Counts and times for the Chaos Lab. They describe this instance only. */
  stats(): RoomStats {
    return {
      pendingEdits: this.scheduler.pendingEdits,
      lastFlushAt: this.scheduler.lastSavedAt,
      lastFlushOutcome: this.scheduler.lastOutcome,
      sockets: this.clients.size,
      serverTime: Date.now(),
    };
  }

  socketCountFor(userId: string): number {
    let count = 0;
    for (const client of this.clients) if (client.data.userId === userId) count += 1;
    return count;
  }

  receive(client: Client, data: Uint8Array): void {
    if (client.closed) return;
    handleMessage(this, client, data);
  }

  removeClient(client: Client): void {
    if (!this.clients.delete(client)) return;
    if (client.awarenessClientId !== null) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [client.awarenessClientId], client);
    }
    this.publishPresence(false);
    if (this.clients.size === 0) this.deps.onEmpty(this);
  }

  /** Stops timers and subscriptions. Callers flush first. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.lastPresence !== 0) void this.deps.bus.setPresence(this.roomId, this.deps.instanceId, 0);
    for (const timer of this.timers) clearInterval(timer);
    if (this.outTimer) clearTimeout(this.outTimer);
    this.scheduler.stop();
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
    this.deps.bus.unsubscribeRoom(this.roomId).catch((err: unknown) => {
      this.log.warn({ err: err instanceof Error ? err.message : err }, 'room unsubscribe failed');
    });
  }

  closeAll(code: number, reason: string): void {
    for (const client of this.clients) client.close(code, reason);
  }

  /** Re-announces our state after a Redis outage, when messages may have been lost. */
  publishStateVector(): void {
    this.publish(BUS_STATE_VECTOR, Y.encodeStateVector(this.doc));
  }

  // ------------------------------------------------------------- outbound

  private broadcast(frame: Uint8Array, except: unknown): void {
    for (const client of this.clients) {
      if (client === except || !client.ready) continue;
      if (!client.send(frame)) {
        securityEvent(this.log, 'slow_consumer', { userId: client.data.userId, roomId: this.roomId });
        client.closed = true;
        client.ws.terminate();
      }
    }
  }

  private publish(kind: typeof BUS_UPDATE | typeof BUS_AWARENESS | typeof BUS_STATE_VECTOR, payload: Uint8Array) {
    const frame = encodeBusFrame(kind, this.deps.instanceId, payload);
    return this.deps.bus.publishSync(this.roomId, frame).catch((err: unknown) => {
      // Anti-entropy repairs this once Redis is back.
      this.log.warn({ err: err instanceof Error ? err.message : err }, 'bus publish failed');
      return 0;
    });
  }

  private scheduleOutbound(): void {
    this.outTimer ??= setTimeout(() => this.flushOutbound(), REDIS_COALESCE_MS);
  }

  /** Merging here turns N edits per socket into at most one PAYG command per window. */
  private flushOutbound(): void {
    this.outTimer = null;
    if (this.outUpdates.length > 0) {
      const merged = Y.mergeUpdates(this.outUpdates);
      this.outUpdates = [];
      void this.publish(BUS_UPDATE, merged);
    }
    if (this.outAwareness.size > 0) {
      const ids = Array.from(this.outAwareness);
      this.outAwareness.clear();
      if (Date.now() >= this.awarenessMutedUntil) {
        const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids);
        void this.publish(BUS_AWARENESS, update).then((receivers) => {
          // Cursors are the bulk of Redis traffic and pointless when no other instance listens.
          if (receivers <= 1) this.awarenessMutedUntil = Date.now() + AWARENESS_PROBE_MS;
        });
      }
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    this.broadcast(encodeSyncUpdate(update), origin);
    if (origin === PERSIST_ORIGIN) return;
    if (origin !== BUS_ORIGIN) {
      this.outUpdates.push(update);
      this.scheduleOutbound();
    }
    // Updates from peers are marked dirty too: if that peer dies before its flush,
    // this instance still holds the only copy.
    this.scheduler.touch();
  };

  private readonly onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const ids = [...change.added, ...change.updated, ...change.removed];
    if (ids.length === 0) return;
    this.broadcast(encodeAwarenessFrame(awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids)), origin);
    if (origin === BUS_ORIGIN) return;
    for (const id of ids) this.outAwareness.add(id);
    this.scheduleOutbound();
  };

  // -------------------------------------------------------------- inbound

  private onBusFrame(data: Uint8Array): void {
    if (this.destroyed) return;
    const frame = decodeBusFrame(data);
    if (!frame || frame.instanceId === this.deps.instanceId) return;
    this.awarenessMutedUntil = 0;

    switch (frame.kind) {
      case BUS_UPDATE:
        Y.applyUpdate(this.doc, frame.payload, BUS_ORIGIN);
        break;
      case BUS_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, frame.payload, BUS_ORIGIN);
        break;
      case BUS_STATE_VECTOR:
        this.answerStateVector(frame.payload);
        break;
    }
  }

  private answerStateVector(peerVector: Uint8Array): void {
    const diff = Y.encodeStateAsUpdate(this.doc, peerVector);
    if (diff.length > EMPTY_UPDATE_LENGTH) void this.publish(BUS_UPDATE, diff);

    const ids = Array.from(this.awareness.getStates().keys());
    if (ids.length > 0) {
      void this.publish(BUS_AWARENESS, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
    }

    const mine = Y.decodeStateVector(Y.encodeStateVector(this.doc));
    if (!covers(mine, Y.decodeStateVector(peerVector))) this.publishStateVector();
  }

  private onControl(json: string): void {
    if (this.destroyed) return;
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return;
    }
    const parsed = controlEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.roomId !== this.roomId) return;
    const event = parsed.data;

    switch (event.type) {
      case 'ROLE_CHANGED':
        for (const client of this.clients) {
          if (client.data.userId !== event.userId) continue;
          client.setRole(event.role);
          client.send(encodeControlFrame({ type: 'ROLE_UPDATED', role: event.role }));
        }
        break;
      case 'MEMBER_REMOVED':
        this.closeUser(event.userId, WS_CLOSE.REMOVED, 'Removed from room');
        break;
      case 'KICK':
        this.closeUser(event.userId, WS_CLOSE.KICKED, 'Kicked');
        break;
      case 'ROOM_DELETED':
        this.onRoomDeleted();
        break;
    }
  }

  private closeUser(userId: string, code: number, reason: string): void {
    for (const client of this.clients) {
      if (client.data.userId === userId) {
        client.setRole('VIEWER');
        client.close(code, reason);
      }
    }
  }

  private onRoomDeleted(): void {
    this.deleted = true;
    this.scheduler.stop();
    this.closeAll(WS_CLOSE.ROOM_DELETED, 'Room deleted');
  }

  /** Backstop for a lost control event: Postgres is the source of truth. */
  async revalidateRoles(): Promise<void> {
    const snapshot = Array.from(this.clients).map((client) => ({ client, epoch: client.roleEpoch }));
    if (snapshot.length === 0) return;
    try {
      const userIds = Array.from(new Set(snapshot.map((s) => s.client.data.userId)));
      const roles = await this.deps.roles.resolveRoles(this.roomId, userIds);
      for (const { client, epoch } of snapshot) {
        if (client.closed || client.roleEpoch !== epoch) continue;
        const role = roles.get(client.data.userId);
        if (!role) {
          client.close(WS_CLOSE.REMOVED, 'Removed from room');
        } else if (role !== client.data.role) {
          client.setRole(role);
          client.send(encodeControlFrame({ type: 'ROLE_UPDATED', role }));
        }
      }
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : err }, 'role revalidation failed');
    }
  }

  // ---------------------------------------------------------- persistence

  /**
   * Lock, then read-merge-compare-and-swap. The lock serialises instances. The merge means
   * a write can never drop edits another instance stored first, and encodeStateAsUpdate
   * produces the compacted form, so the row never holds an incremental log (PRD §3.3).
   */
  private async persist(): Promise<FlushOutcome> {
    if (this.deleted) return 'skipped';
    const key = flushLockKey(this.roomId);
    const token = await this.deps.bus.acquireLock(key, FLUSH_LOCK_TTL_MS);
    if (!token) return 'busy';

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = await this.deps.snapshots.readVersion(this.roomId);
        if (version === null) {
          this.onRoomDeleted();
          return 'skipped';
        }

        let stored: Uint8Array | null = null;
        if (version !== this.version) {
          const snapshot = await this.deps.snapshots.load(this.roomId);
          if (!snapshot) {
            this.onRoomDeleted();
            return 'skipped';
          }
          stored = snapshot.bytes;
          this.version = snapshot.version;
          if (stored) Y.applyUpdate(this.doc, stored, PERSIST_ORIGIN);
        }

        const bytes = Y.encodeStateAsUpdate(this.doc);
        if (stored && sameBytes(stored, bytes)) return 'skipped';

        if (bytes.length > MAX_SNAPSHOT_BYTES) {
          this.overQuota = true;
          this.log.error({ bytes: bytes.length }, 'room snapshot over quota, edits are now refused');
          return 'skipped';
        }

        const saved = await this.deps.snapshots.save(this.roomId, bytes, this.version);
        if (saved !== null) {
          this.version = saved;
          return 'saved';
        }
      }
      return 'busy';
    } finally {
      await this.deps.bus.releaseLock(key, token).catch(() => undefined);
    }
  }
}

export function newInstanceId(): string {
  return randomUUID();
}
