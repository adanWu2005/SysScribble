import { MUTATING_ROLES, roomSnapshotParamsSchema } from '@wb/shared';
import { ApiError, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { getSnapshotBytes } from '@/lib/db/snapshots';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

type Params = { roomId: string; snapshotId: string };

/**
 * GET /api/rooms/:roomId/snapshots/:snapshotId — the raw saved document, for preview and restore.
 * OWNER or EDITOR only. The browser reads it into a throwaway Y.Doc and validates every shape
 * and every note node on the way out, exactly as it does for a live document.
 */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId, snapshotId } = parseParams(params, roomSnapshotParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, MUTATING_ROLES);
  await enforceRateLimit('snapshotRead', user.userId);

  const bytes = await getSnapshotBytes(roomId, snapshotId);
  if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Version not found');

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
