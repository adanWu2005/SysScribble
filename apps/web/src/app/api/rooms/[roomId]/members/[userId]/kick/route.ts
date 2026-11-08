import { OWNER_ONLY, roomMemberParamsSchema } from '@wb/shared';
import { ApiError, json, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { findMemberRole } from '@/lib/db/members';
import { removeFromHuddle } from '@/lib/livekit';
import { banFromRoom, publishControlEvent } from '@/lib/redis-publish';

export const dynamic = 'force-dynamic';

type Params = { roomId: string; userId: string };

/**
 * POST /api/rooms/:roomId/members/:userId/kick — OWNER terminates a member's live
 * connections on every WS instance without changing their membership.
 */
export const POST = route<Params>(async ({ req, params }) => {
  const { roomId, userId: targetId } = parseParams(params, roomMemberParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, OWNER_ONLY);
  if (targetId === user.userId) throw new ApiError(400, 'BAD_REQUEST', 'You cannot kick yourself');

  const targetRole = await findMemberRole(roomId, targetId);
  if (targetRole === null) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
  if (targetRole === 'OWNER') throw new ApiError(400, 'BAD_REQUEST', 'The owner cannot be kicked');

  await banFromRoom(roomId, targetId);
  await publishControlEvent({ type: 'KICK', roomId, userId: targetId });
  await removeFromHuddle(roomId, targetId);
  return json({ ok: true as const });
});
