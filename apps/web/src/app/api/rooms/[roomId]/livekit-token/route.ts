import {
  LIVEKIT_TOKEN_TTL_SEC,
  canMutate,
  roomIdParamsSchema,
  type LivekitTokenResponse,
} from '@wb/shared';
import { json, parseParams, route } from '@/lib/api';
import { requireRoomMember } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { publicEnv } from '@/lib/env';
import { mintHuddleToken } from '@/lib/livekit';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** POST /api/rooms/:roomId/livekit-token — any member, with grants scoped to their role. */
export const POST = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  const role = await requireRoomMember(roomId, user.userId);
  await enforceRateLimit('livekitToken', user.userId);

  const name = user.email?.split('@')[0] ?? 'Guest';
  const response: LivekitTokenResponse = {
    token: await mintHuddleToken(roomId, user.userId, name, role),
    url: publicEnv.NEXT_PUBLIC_LIVEKIT_URL,
    canPublish: canMutate(role),
    expiresAt: new Date(Date.now() + LIVEKIT_TOKEN_TTL_SEC * 1000).toISOString(),
  };
  return json(response);
});
