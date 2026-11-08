import {
  CHECKPOINT_LABEL,
  MUTATING_ROLES,
  checkpointRequestSchema,
  roomIdParamsSchema,
  type CheckpointResponse,
  type SnapshotListResponse,
} from '@wb/shared';
import { json, parseBody, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { listSnapshots, recordCheckpoint } from '@/lib/db/snapshots';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** GET /api/rooms/:roomId/snapshots — OWNER or EDITOR sees the saved versions, newest first. */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, MUTATING_ROLES);

  const response: SnapshotListResponse = { snapshots: await listSnapshots(roomId) };
  return json(response);
});

/**
 * POST /api/rooms/:roomId/snapshots — keeps the room's current saved state in history before a
 * restore replaces it. The server copies what the database holds. The client sends no bytes and
 * no label, only the reason, so nothing a client says can end up in history.
 */
export const POST = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, MUTATING_ROLES);
  await enforceRateLimit('restore', user.userId);
  await parseBody(req, checkpointRequestSchema);

  const response: CheckpointResponse = { checkpointId: await recordCheckpoint(roomId, CHECKPOINT_LABEL) };
  return json(response, { status: 201 });
});
