import 'server-only';
import type { Room, RoomWithRole, Tables } from '@wb/shared';
import { bytesToBytea } from '@wb/shared/server';
import { ApiError } from '@/lib/api';
import { getAdminClient } from '@/lib/supabase/admin';

type RoomRow = Pick<Tables<'rooms'>, 'id' | 'owner_id' | 'title' | 'version' | 'created_at' | 'updated_at'>;

/** Never select yjs_snapshot here — it can be megabytes and only the WS server needs it. */
const ROOM_COLUMNS = 'id, owner_id, title, version, created_at, updated_at' as const;

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRoomsForUser(userId: string): Promise<RoomWithRole[]> {
  const admin = getAdminClient();
  const memberships = await admin.from('room_members').select('room_id, role').eq('user_id', userId);
  if (memberships.error) throw new ApiError(500, 'INTERNAL', 'Database error');
  if (memberships.data.length === 0) return [];

  const roleByRoom = new Map(memberships.data.map((m) => [m.room_id, m.role] as const));
  const rooms = await admin
    .from('rooms')
    .select(ROOM_COLUMNS)
    .in('id', Array.from(roleByRoom.keys()))
    .order('updated_at', { ascending: false });
  if (rooms.error) throw new ApiError(500, 'INTERNAL', 'Database error');

  return rooms.data.flatMap((row) => {
    const role = roleByRoom.get(row.id);
    return role ? [{ ...toRoom(row), role }] : [];
  });
}

export async function getRoom(roomId: string): Promise<Room | null> {
  const { data, error } = await getAdminClient().from('rooms').select(ROOM_COLUMNS).eq('id', roomId).maybeSingle();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data ? toRoom(data) : null;
}

export async function createRoom(ownerId: string, title: string): Promise<Room> {
  const admin = getAdminClient();
  const { data: roomId, error } = await admin.rpc('create_room_with_owner', { p_title: title, p_owner_id: ownerId });
  if (error || !roomId) throw new ApiError(500, 'INTERNAL', 'Could not create room');
  const room = await getRoom(roomId);
  if (!room) throw new ApiError(500, 'INTERNAL', 'Room vanished after creation');
  return room;
}

/** Stores a new room's first snapshot. Only the server builds these, from a template it chose. */
export async function setInitialSnapshot(roomId: string, bytes: Uint8Array): Promise<void> {
  const { error } = await getAdminClient()
    .from('rooms')
    .update({ yjs_snapshot: bytesToBytea(bytes) })
    .eq('id', roomId);
  if (error) throw new ApiError(500, 'INTERNAL', 'Could not store the template');
}

export async function updateRoomTitle(roomId: string, title: string): Promise<Room | null> {
  const { data, error } = await getAdminClient()
    .from('rooms')
    .update({ title })
    .eq('id', roomId)
    .select(ROOM_COLUMNS)
    .maybeSingle();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data ? toRoom(data) : null;
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { error } = await getAdminClient().from('rooms').delete().eq('id', roomId);
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
}
