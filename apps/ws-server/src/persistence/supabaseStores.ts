import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, RoomRole } from '@wb/shared';
import { SERVICE_CLIENT_OPTIONS, byteaToBytes, bytesToBytea } from '@wb/shared/server';
import type { RoleStore, SnapshotStore, StoredSnapshot } from './stores';

type Admin = SupabaseClient<Database>;

/** Service-role client: RLS does not apply, so callers have already authenticated the socket. */
export function createAdminClient(url: string, serviceRoleKey: string): Admin {
  return createClient<Database>(url, serviceRoleKey, SERVICE_CLIENT_OPTIONS);
}

export class SupabaseSnapshotStore implements SnapshotStore {
  constructor(private readonly admin: Admin) {}

  async load(roomId: string): Promise<StoredSnapshot | null> {
    const { data, error } = await this.admin
      .from('rooms')
      .select('yjs_snapshot, version')
      .eq('id', roomId)
      .maybeSingle();
    if (error) throw new Error(`load snapshot failed: ${error.message}`);
    return data ? { bytes: byteaToBytes(data.yjs_snapshot), version: data.version } : null;
  }

  async readVersion(roomId: string): Promise<number | null> {
    const { data, error } = await this.admin.from('rooms').select('version').eq('id', roomId).maybeSingle();
    if (error) throw new Error(`read version failed: ${error.message}`);
    return data?.version ?? null;
  }

  async save(roomId: string, bytes: Uint8Array, expectedVersion: number): Promise<number | null> {
    const { data, error } = await this.admin
      .from('rooms')
      .update({ yjs_snapshot: bytesToBytea(bytes) })
      .eq('id', roomId)
      .eq('version', expectedVersion)
      .select('version')
      .maybeSingle();
    if (error) throw new Error(`save snapshot failed: ${error.message}`);
    return data?.version ?? null;
  }
}

export class SupabaseRoleStore implements RoleStore {
  constructor(private readonly admin: Admin) {}

  async resolveRole(roomId: string, userId: string): Promise<RoomRole | null> {
    const { data, error } = await this.admin
      .from('room_members')
      .select('role')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`resolve role failed: ${error.message}`);
    return data?.role ?? null;
  }

  async resolveRoles(roomId: string, userIds: string[]): Promise<Map<string, RoomRole>> {
    if (userIds.length === 0) return new Map();
    const { data, error } = await this.admin
      .from('room_members')
      .select('user_id, role')
      .eq('room_id', roomId)
      .in('user_id', userIds);
    if (error) throw new Error(`resolve roles failed: ${error.message}`);
    return new Map(data.map((row) => [row.user_id, row.role]));
  }
}
