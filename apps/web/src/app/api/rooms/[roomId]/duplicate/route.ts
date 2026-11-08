import { MUTATING_ROLES, roomIdParamsSchema } from '@wb/shared';
import { ApiError, json, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { duplicateRoom } from '@/lib/db/duplicate';
import { getRoom } from '@/lib/db/rooms';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/**
 * POST /api/rooms/:roomId/duplicate — OWNER or EDITOR of the source. The copy belongs to the caller
 * alone: nobody else from the source room is carried over, and uploaded files are copied to new keys.
 */
export const POST = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, MUTATING_ROLES);
  await enforceRateLimit('roomDuplicate', user.userId);

  const source = await getRoom(roomId);
  if (!source) throw new ApiError(404, 'NOT_FOUND', 'Room not found');
  const room = await duplicateRoom(roomId, source.title, user.userId);
  return json({ room, role: 'OWNER' as const }, { status: 201 });
});
