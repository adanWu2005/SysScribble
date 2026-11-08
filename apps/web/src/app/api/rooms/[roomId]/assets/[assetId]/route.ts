import { MUTATING_ROLES, PRESIGN_GET_TTL_SEC, roomAssetParamsSchema } from '@wb/shared';
import { ApiError, json, parseParams, route } from '@/lib/api';
import { requireRoomMember, requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { deleteAssetRow, findAsset } from '@/lib/db/assets';
import { deleteObject, presignGet } from '@/lib/r2';

export const dynamic = 'force-dynamic';

type Params = { roomId: string; assetId: string };

/** GET /api/rooms/:roomId/assets/:assetId — any member gets a short-lived read URL. */
export const GET = route<Params>(async ({ req, params }) => {
  const { roomId, assetId } = parseParams(params, roomAssetParamsSchema);
  const user = await requireUser(req);
  await requireRoomMember(roomId, user.userId);

  const asset = await findAsset(roomId, assetId);
  if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Asset not found');
  return json({
    url: await presignGet(asset.objectKey, asset.mimeType),
    expiresAt: new Date(Date.now() + PRESIGN_GET_TTL_SEC * 1000).toISOString(),
  });
});

/**
 * DELETE /api/rooms/:roomId/assets/:assetId — OWNER, or the EDITOR who uploaded it.
 * The key comes from the row, never the request (PRD §5.2).
 */
export const DELETE = route<Params>(async ({ req, params }) => {
  const { roomId, assetId } = parseParams(params, roomAssetParamsSchema);
  const user = await requireUser(req);
  const role = await requireRoomRole(roomId, user.userId, MUTATING_ROLES);

  const asset = await findAsset(roomId, assetId);
  if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Asset not found');
  if (role !== 'OWNER' && asset.uploadedBy !== user.userId) {
    throw new ApiError(403, 'INSUFFICIENT_ROLE', 'You can only delete your own uploads');
  }

  await deleteObject(asset.objectKey);
  await deleteAssetRow(roomId, assetId);
  return json({ ok: true as const });
});
