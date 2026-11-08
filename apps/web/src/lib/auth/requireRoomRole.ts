import { ALL_ROLES, type RoomRole } from '@wb/shared';
import { ApiError } from '@/lib/api';
import { findMemberRole } from '@/lib/db/members';

export type MemberRoleLookup = (roomId: string, userId: string) => Promise<RoomRole | null>;

/**
 * Authorization gate (PRD §5.3). Resolves the caller's row in `room_members` for this
 * exact room and rejects unless the role is in `allowed`. Returns the role so callers
 * can branch on it without a second query.
 */
export async function requireRoomRole(
  roomId: string,
  userId: string,
  allowed: readonly RoomRole[],
  lookup: MemberRoleLookup = findMemberRole,
): Promise<RoomRole> {
  const role = await lookup(roomId, userId);
  if (role === null) {
    throw new ApiError(403, 'FORBIDDEN', 'You are not a member of this room');
  }
  if (!allowed.includes(role)) {
    throw new ApiError(403, 'INSUFFICIENT_ROLE', `This action requires role: ${allowed.join(' or ')}`);
  }
  return role;
}

/** Any member. */
export function requireRoomMember(roomId: string, userId: string, lookup?: MemberRoleLookup): Promise<RoomRole> {
  return requireRoomRole(roomId, userId, ALL_ROLES, lookup);
}
