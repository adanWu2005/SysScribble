import { randomUUID } from 'node:crypto';
import {
  MUTATING_ROLES,
  PRESIGN_PUT_TTL_SEC,
  roomIdParamsSchema,
  uploadUrlRequestSchema,
  type UploadUrlResponse,
} from '@wb/shared';
import { ApiError, json, parseBody, parseParams, route } from '@/lib/api';
import { requireRoomRole } from '@/lib/auth/requireRoomRole';
import { requireUser } from '@/lib/auth/requireUser';
import { reserveAsset } from '@/lib/db/assets';
import { buildObjectKey, presignPut } from '@/lib/r2';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

type Params = { roomId: string };

/** POST /api/rooms/:roomId/upload-url — OWNER or EDITOR gets one size-bound upload slot. */
export const POST = route<Params>(async ({ req, params }) => {
  const { roomId } = parseParams(params, roomIdParamsSchema);
  const user = await requireUser(req);
  await requireRoomRole(roomId, user.userId, MUTATING_ROLES);
  await enforceRateLimit('uploadUrl', user.userId);
  const body = await parseBody(req, uploadUrlRequestSchema);

  const assetId = randomUUID();
  const objectKey = buildObjectKey(roomId, assetId, body.contentType);
  const reserved = await reserveAsset({
    id: assetId,
    roomId,
    uploadedBy: user.userId,
    objectKey,
    mimeType: body.contentType,
    sizeBytes: body.sizeBytes,
  });
  if (!reserved) throw new ApiError(413, 'STORAGE_QUOTA_EXCEEDED', 'This workspace is out of storage');

  const response: UploadUrlResponse = {
    assetId,
    objectKey,
    uploadUrl: await presignPut(objectKey, body.contentType, body.sizeBytes),
    expiresAt: new Date(Date.now() + PRESIGN_PUT_TTL_SEC * 1000).toISOString(),
    requiredHeaders: { 'Content-Type': body.contentType, 'Content-Length': String(body.sizeBytes) },
  };
  return json(response, { status: 201 });
});
