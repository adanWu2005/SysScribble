import { MUTATING_ROLES, OWNER_ONLY, roomIdParamsSchema, updateRoomSchema } from '@wb/shared';
import { ApiError, json, parseBody, parseParams, route } from '@/lib/api';
import { requireRoomMember, requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { listAssetKeys } from '@/lib/db/assets';
import { deleteRoom, getRoom, updateRoomTitle } from '@/lib/db/rooms';
import { deleteObjects } from '@/lib/r2';
import { publishControlEvent } from '@/lib/redis-publish';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** GET /api/rooms/:roomId — any member. */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  const role = await requireRoomMember(roomId, user.userId);
  const room = await getRoom(roomId);
  if (!room) throw new ApiError(404, 'NOT_FOUND', 'Room not found');
  return json({ room, role });
});

/** PATCH /api/rooms/:roomId — OWNER or EDITOR renames. A viewer cannot change the document, so not its name either. */
export const PATCH = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  const role = await requireRoomRole(roomId, user.userId, MUTATING_ROLES);
  const body = await parseBody(req, updateRoomSchema);
  const room = await updateRoomTitle(roomId, body.title);
  if (!room) throw new ApiError(404, 'NOT_FOUND', 'Room not found');
  return json({ room, role });
});

/** DELETE /api/rooms/:roomId — OWNER only. Cascades members/invites/assets; evicts live sockets. */
export const DELETE = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, OWNER_ONLY);
  // Read the keys first: the cascade removes the rows, but never the R2 objects.
  const keys = await listAssetKeys(roomId);
  await deleteRoom(roomId);
  await publishControlEvent({ type: 'ROOM_DELETED', roomId });
  await deleteObjects(keys).catch((err: unknown) => {
    console.error('[rooms] orphaned R2 objects', roomId, err instanceof Error ? err.message : err);
  });
  return json({ ok: true as const });
});
