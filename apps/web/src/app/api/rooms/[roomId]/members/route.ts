import { roomIdParamsSchema } from '@wb/shared';
import { json, parseParams, route } from '@/lib/api';
import { requireRoomMember } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { listMembers } from '@/lib/db/members';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** GET /api/rooms/:roomId/members — any member may see who else is in the room. */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomMember(roomId, user.userId);
  const members = await listMembers(roomId);
  return json({ members });
});
