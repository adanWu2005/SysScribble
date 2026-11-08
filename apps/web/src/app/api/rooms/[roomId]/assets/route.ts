import { roomIdParamsSchema } from '@wb/shared';
import { json, parseParams, route } from '@/lib/api';
import { requireRoomMember } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { listAssets } from '@/lib/db/assets';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** GET /api/rooms/:roomId/assets — any member. */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomMember(roomId, user.userId);
  return json({ assets: await listAssets(roomId) });
});
