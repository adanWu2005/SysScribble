import { inviteIdParamsSchema } from '@wb/shared';
import { ApiError, json, parseParams, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { declineInviteById } from '@/lib/db/invites';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

type Params = { inviteId: string };

/**
 * POST /api/invites/:inviteId/decline — deletes an invitation addressed to the caller, so the
 * emailed link stops working too. Someone else's invite, a used one and a made-up id all answer alike.
 */
export const POST = route<Params>(async ({ req, params }) => {
  const { inviteId } = parseParams(params, inviteIdParamsSchema);
  const user = await requireUser(req);
  await enforceRateLimit('inviteDecline', user.userId);
  if (!user.email || !(await declineInviteById(inviteId, user.email))) {
    throw new ApiError(400, 'INVITE_INVALID', 'This invite is invalid, expired or already used');
  }
  return json({ ok: true as const });
});
