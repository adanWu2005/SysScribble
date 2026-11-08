import { OWNER_ONLY, roomMemberParamsSchema, updateMemberRoleSchema } from '@wb/shared';
import { ApiError, json, parseBody, parseParams, route } from '@/lib/api';
import { requireRoomMember, requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { removeMember, updateMemberRole } from '@/lib/db/members';
import { removeFromHuddle, setHuddlePermissions } from '@/lib/livekit';
import { publishControlEvent } from '@/lib/redis-publish';

export const dynamic = 'force-dynamic';

type Params = { roomId: string; userId: string };

/**
 * PATCH /api/rooms/:roomId/members/:userId — OWNER changes another member's role.
 * Publishes ROLE_CHANGED so open sockets are downgraded within ~100 ms (PRD §6.4).
 */
export const PATCH = route<Params>(async ({ req, params }) => {
  const { roomId, userId: targetId } = parseParams(params, roomMemberParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, OWNER_ONLY);
  if (targetId === user.userId) throw new ApiError(400, 'BAD_REQUEST', 'Owners cannot change their own role');

  const body = await parseBody(req, updateMemberRoleSchema);
  const changed = await updateMemberRole(roomId, targetId, body.role);
  if (!changed) throw new ApiError(404, 'NOT_FOUND', 'Member not found');

  await publishControlEvent({ type: 'ROLE_CHANGED', roomId, userId: targetId, role: body.role });
  await setHuddlePermissions(roomId, targetId, body.role);
  return json({ ok: true as const, role: body.role });
});

/**
 * DELETE /api/rooms/:roomId/members/:userId — OWNER removes a member, or a non-owner
 * removes themselves (leave). Publishes MEMBER_REMOVED so sockets close everywhere.
 */
export const DELETE = route<Params>(async ({ req, params }) => {
  const { roomId, userId: targetId } = parseParams(params, roomMemberParamsSchema);
  const user = await requireUser(req);

  if (targetId === user.userId) {
    const own = await requireRoomMember(roomId, user.userId);
    if (own === 'OWNER') throw new ApiError(400, 'BAD_REQUEST', 'Owners cannot leave; delete the room instead');
  } else {
    await requireRoomRole(roomId, user.userId, OWNER_ONLY);
  }

  const removed = await removeMember(roomId, targetId);
  if (!removed) throw new ApiError(404, 'NOT_FOUND', 'Member not found');

  await publishControlEvent({ type: 'MEMBER_REMOVED', roomId, userId: targetId });
  await removeFromHuddle(roomId, targetId);
  return json({ ok: true as const });
});
