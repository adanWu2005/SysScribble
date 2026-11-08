import { OWNER_ONLY, roomInviteParamsSchema } from '@wb/shared';
import { ApiError, json, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { revokeInvite } from '@/lib/db/invites';

export const dynamic = 'force-dynamic';

type Params = { roomId: string; inviteId: string };

/** DELETE /api/rooms/:roomId/invites/:inviteId — OWNER revokes a pending invite. */
export const DELETE = route<Params>(async ({ req, params }) => {
  const { roomId, inviteId } = parseParams(params, roomInviteParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, OWNER_ONLY);

  const revoked = await revokeInvite(roomId, inviteId);
  if (!revoked) throw new ApiError(404, 'NOT_FOUND', 'Invite not found');
  return json({ ok: true as const });
});
