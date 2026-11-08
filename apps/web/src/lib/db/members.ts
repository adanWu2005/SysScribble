import 'server-only';
import type { AssignableRole, Member, RoomRole } from '@wb/shared';
import { ApiError } from '@/lib/api';
import { getAdminClient } from '@/lib/supabase/admin';

/** The single source of truth for "is this user in this room, and as what?" */
export async function findMemberRole(roomId: string, userId: string): Promise<RoomRole | null> {
  const { data, error } = await getAdminClient()
    .from('room_members')
    .select('role')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data?.role ?? null;
}

export async function listMembers(roomId: string): Promise<Member[]> {
  const admin = getAdminClient();
  const members = await admin
    .from('room_members')
    .select('user_id, role, joined_at')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  if (members.error) throw new ApiError(500, 'INTERNAL', 'Database error');
  if (members.data.length === 0) return [];

  const profiles = await admin
    .from('profiles')
    .select('id, email, display_name, avatar_url')
    .in(
      'id',
      members.data.map((m) => m.user_id),
    );
  if (profiles.error) throw new ApiError(500, 'INTERNAL', 'Database error');
  const profileById = new Map(profiles.data.map((p) => [p.id, p] as const));

  return members.data.map((m) => {
    const p = profileById.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      email: p?.email ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
    };
  });
}

/** Returns false when no non-owner row matched (unknown member or attempted owner edit). */
export async function updateMemberRole(roomId: string, userId: string, role: AssignableRole): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('room_members')
    .update({ role })
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .neq('role', 'OWNER')
    .select('user_id');
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.length > 0;
}

/** Returns false when no non-owner row matched. */
export async function removeMember(roomId: string, userId: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .neq('role', 'OWNER')
    .select('user_id');
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.length > 0;
}
