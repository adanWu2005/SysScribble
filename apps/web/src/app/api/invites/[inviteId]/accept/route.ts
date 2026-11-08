import { inviteIdParamsSchema } from '@wb/shared';
import { ApiError, json, parseParams, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { acceptInviteById } from '@/lib/db/invites';
import { findMemberRole } from '@/lib/db/members';
import { enforceRateLimit } from '@/lib/ratelimit';
import { publishControlEvent } from '@/lib/redis-publish';

export const dynamic = 'force-dynamic';

type Params = { inviteId: string };

/**
 * POST /api/invites/:inviteId/accept — accepts an invitation from the dashboard. The invite must be
 * addressed to the caller's verified email, so a guessed or leaked id is useless to anyone else.
 */
export const POST = route<Params>(async ({ req, params }) => {
  const { inviteId } = parseParams(params, inviteIdParamsSchema);
  const user = await requireUser(req);
  await enforceRateLimit('inviteAccept', user.userId);
  if (!user.email) throw new ApiError(400, 'INVITE_INVALID', 'This invite is invalid, expired or already used');

  const roomId = await acceptInviteById(inviteId, user.userId, user.email);
  const role = await findMemberRole(roomId, user.userId);
  if (!role) throw new ApiError(500, 'INTERNAL', 'Membership missing after accept');

  // Someone already in the room may have just changed role, and their sockets must follow.
  await publishControlEvent({ type: 'ROLE_CHANGED', roomId, userId: user.userId, role });
  return json({ roomId, role });
});
