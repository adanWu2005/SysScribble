import { acceptInviteSchema } from '@wb/shared';
import { ApiError, json, parseBody, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { acceptInvite } from '@/lib/db/invites';
import { findMemberRole } from '@/lib/db/members';
import { hashInviteToken } from '@/lib/invites';
import { enforceRateLimit } from '@/lib/ratelimit';
import { publishControlEvent } from '@/lib/redis-publish';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invites/accept — no room id in the path, because the invitee is not a member
 * yet. The email comes from the verified JWT, never the request body, so a stolen link
 * is useless to any other account.
 */
export const POST = route(async ({ req }) => {
  const user = await requireUser(req);
  await enforceRateLimit('inviteAccept', user.userId);
  const { token } = await parseBody(req, acceptInviteSchema);
  if (!user.email) throw new ApiError(400, 'INVITE_INVALID', 'This invite is invalid, expired or already used');

  const roomId = await acceptInvite(hashInviteToken(token), user.userId, user.email);
  const role = await findMemberRole(roomId, user.userId);
  if (!role) throw new ApiError(500, 'INTERNAL', 'Membership missing after accept');

  // Someone already in the room may have just changed role, and their sockets must follow.
  await publishControlEvent({ type: 'ROLE_CHANGED', roomId, userId: user.userId, role });
  return json({ roomId, role });
});
