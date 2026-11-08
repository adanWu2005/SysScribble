import { ROOM_EVICT_GRACE_MS, WS_CLOSE } from '@wb/shared';
import type { Logger } from '../logger';
import type { RoleStore, SnapshotStore } from '../persistence/stores';
import type { Bus } from '../redis/bus';
import { Room } from './Room';

export interface RoomManagerDeps {
  bus: Bus;
  snapshots: SnapshotStore;
  roles: RoleStore;
  log: Logger;
  instanceId: string;
  flush?: { debounceMs?: number; maxWaitMs?: number };
  evictGraceMs?: number;
}

/** Owns the room lifecycle: load on first join, flush on last leave, evict once clean. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly deps: RoomManagerDeps) {
    deps.bus.onReconnect(() => {
      for (const room of this.rooms.values()) room.publishStateVector();
    });
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  acquire(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room = new Room(roomId, {
      bus: this.deps.bus,
      snapshots: this.deps.snapshots,
      roles: this.deps.roles,
      log: this.deps.log,
      instanceId: this.deps.instanceId,
      onEmpty: (r) => void this.onRoomEmpty(r),
      ...(this.deps.flush ? { flush: this.deps.flush } : {}),
    });
    this.rooms.set(roomId, room);
    room.ready.catch((err: unknown) => {
      this.deps.log.error({ roomId, err: err instanceof Error ? err.message : err }, 'room load failed');
      room.closeAll(WS_CLOSE.SERVER_SHUTDOWN, 'Room failed to load');
      this.evict(room);
    });
    return room;
  }

  private evict(room: Room): void {
    if (this.rooms.get(room.roomId) === room) this.rooms.delete(room.roomId);
    room.destroy();
  }

  /** PRD §3.3 trigger 3. Keeps retrying rather than dropping unsaved edits. */
  private async onRoomEmpty(room: Room): Promise<void> {
    await room.ready.catch(() => undefined);
    await room.scheduler.flushNow();
    await new Promise((resolve) => setTimeout(resolve, this.deps.evictGraceMs ?? ROOM_EVICT_GRACE_MS));
    if (room.destroyed || room.clients.size > 0) return;
    if (room.scheduler.dirty) {
      void this.onRoomEmpty(room);
      return;
    }
    this.evict(room);
  }

  /** Graceful shutdown: every room is flushed before its sockets are told to reconnect. */
  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.rooms.values()).map(async (room) => {
        await room.ready.catch(() => undefined);
        await room.scheduler.flushNow();
        room.closeAll(WS_CLOSE.SERVER_SHUTDOWN, 'Server restarting');
        this.evict(room);
      }),
    );
  }
}
