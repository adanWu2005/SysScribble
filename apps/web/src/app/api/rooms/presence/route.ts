import type { PresenceResponse } from '@wb/shared';
import { json, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { listRoomsForUser } from '@/lib/db/rooms';
import { readRoomPresence } from '@/lib/presence';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/presence — how many people are in each of YOUR rooms right now. There is no id
 * in the request: the rooms come from the caller's memberships, so nobody can ask about a room
 * they are not in.
 */
export const GET = route(async ({ req }) => {
  const user = await requireUser(req);
  await enforceRateLimit('presenceRead', user.userId);
  const rooms = await listRoomsForUser(user.userId);
  const presence: PresenceResponse['presence'] = await readRoomPresence(rooms.map((room) => room.id));
  return json({ presence });
});
