import { OWNER_ONLY, createInviteSchema, roomIdParamsSchema } from '@wb/shared';
import { ApiError, json, parseBody, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { createInvite, deleteInvite, listPendingInvites } from '@/lib/db/invites';
import { getRoom } from '@/lib/db/rooms';
import { generateInviteToken, hashInviteToken } from '@/lib/invites';
import { enforceRateLimit } from '@/lib/ratelimit';
import { sendInviteEmail } from '@/lib/resend';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** GET /api/rooms/:roomId/invite — OWNER lists pending invites. */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, OWNER_ONLY);
  return json({ invites: await listPendingInvites(roomId) });
});

/** POST /api/rooms/:roomId/invite — OWNER only, 10 per user per hour (PRD §5.6). */
export const POST = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, OWNER_ONLY);
  await enforceRateLimit('invite', user.userId);
  const body = await parseBody(req, createInviteSchema);

  const room = await getRoom(roomId);
  if (!room) throw new ApiError(404, 'NOT_FOUND', 'Room not found');

  const token = generateInviteToken();
  const invite = await createInvite({
    roomId,
    email: body.email,
    role: body.role,
    tokenHash: hashInviteToken(token),
    createdBy: user.userId,
  });

  try {
    await sendInviteEmail({ to: body.email, roomTitle: room.title, token });
  } catch (err) {
    console.error('[invite] email failed', err instanceof Error ? err.message : err);
    await deleteInvite(invite.id);
    throw new ApiError(502, 'UNAVAILABLE', 'Could not send the invitation email');
  }

  // The token goes to the invitee only. It is never in this response.
  return json({ invite }, { status: 201 });
});
