import type { RoomRole } from '@wb/shared';

export interface StoredSnapshot {
  bytes: Uint8Array | null;
  version: number;
}

export interface SnapshotStore {
  /** Null when the room row does not exist (for example it was deleted). */
  load(roomId: string): Promise<StoredSnapshot | null>;
  /** Cheap check that avoids downloading the snapshot on every flush. */
  readVersion(roomId: string): Promise<number | null>;
  /** Compare-and-swap on `version`. Null means another writer got there first. */
  save(roomId: string, bytes: Uint8Array, expectedVersion: number): Promise<number | null>;
}

export interface RoleStore {
  resolveRole(roomId: string, userId: string): Promise<RoomRole | null>;
  /** Users missing from the returned map are no longer members. */
  resolveRoles(roomId: string, userIds: string[]): Promise<Map<string, RoomRole>>;
}
