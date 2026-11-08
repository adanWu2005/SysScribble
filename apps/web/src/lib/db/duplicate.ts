import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  DUPLICATE_MAX_ASSETS,
  ROOM_TITLE_MAX,
  allowedUploadMimeSchema,
  type Asset,
  type Room,
} from '@wb/shared';
import { byteaToBytes } from '@wb/shared/server';
import * as Y from 'yjs';
import { ApiError } from '@/lib/api';
import { listAssets, reserveAsset } from '@/lib/db/assets';
import { createRoom, deleteRoom, setInitialSnapshot } from '@/lib/db/rooms';
import { buildObjectKey, copyObject, deleteObjects } from '@/lib/r2';
import { getAdminClient } from '@/lib/supabase/admin';
import { deleteShapes, readShapes, updateShapes } from '@/lib/whiteboard/model';

const COPY_SUFFIX = ' (copy)';
const COPY_CONCURRENCY = 5;

function copyTitle(title: string): string {
  const room = ROOM_TITLE_MAX - COPY_SUFFIX.length;
  return `${Array.from(title).slice(0, room).join('')}${COPY_SUFFIX}`;
}

async function readSourceSnapshot(roomId: string): Promise<Uint8Array | null> {
  const { data, error } = await getAdminClient().from('rooms').select('yjs_snapshot').eq('id', roomId).maybeSingle();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data?.yjs_snapshot ? byteaToBytes(data.yjs_snapshot) : null;
}

/** Runs `task` over `items`, a few at a time. */
async function inBatches<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += COPY_CONCURRENCY) {
    await Promise.all(items.slice(i, i + COPY_CONCURRENCY).map(task));
  }
}

/**
 * Points the copied board at the copied files. A picture or PDF whose file could not be carried
 * over is removed from the copy, so the copy never shows a broken image that 403s for everyone.
 */
export function remapAssets(doc: Y.Doc, assetIdMap: ReadonlyMap<string, string>): void {
  const patches: Record<string, { assetId: string }> = {};
  const orphans: string[] = [];
  for (const shape of readShapes(doc)) {
    if (shape.type !== 'image' && shape.type !== 'file') continue;
    const next = assetIdMap.get(shape.assetId);
    if (next) patches[shape.id] = { assetId: next };
    else orphans.push(shape.id);
  }
  updateShapes(doc, patches);
  deleteShapes(doc, orphans);
}

/**
 * Copies a workspace into a new one owned by `ownerId`: its board and notes, and its uploaded
 * files, which are copied to new keys under the new room. The caller has already checked that the
 * owner may read the source. If anything fails, everything made so far is removed.
 */
export async function duplicateRoom(sourceRoomId: string, sourceTitle: string, ownerId: string): Promise<Room> {
  const assets = await listAssets(sourceRoomId);
  if (assets.length > DUPLICATE_MAX_ASSETS) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'This workspace has too many uploaded files to duplicate in one go');
  }

  const snapshot = await readSourceSnapshot(sourceRoomId);
  const room = await createRoom(ownerId, copyTitle(sourceTitle));
  const copiedKeys: string[] = [];
  try {
    const idMap = new Map<string, string>();
    await inBatches(assets, async (asset: Asset) => {
      const mime = allowedUploadMimeSchema.safeParse(asset.mimeType);
      if (!mime.success) return;
      const newId = randomUUID();
      const key = buildObjectKey(room.id, newId, mime.data);
      // Reserve first: the quota check and the row are one atomic step, and a refusal copies nothing.
      const reserved = await reserveAsset({
        id: newId,
        roomId: room.id,
        uploadedBy: ownerId,
        objectKey: key,
        mimeType: mime.data,
        sizeBytes: asset.sizeBytes,
      });
      if (!reserved) throw new ApiError(413, 'STORAGE_QUOTA_EXCEEDED', 'Not enough storage to copy the uploaded files');
      copiedKeys.push(key);
      await copyObject(asset.objectKey, key, mime.data);
      idMap.set(asset.id, newId);
    });

    if (snapshot) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, snapshot);
      remapAssets(doc, idMap);
      await setInitialSnapshot(room.id, Y.encodeStateAsUpdate(doc));
      doc.destroy();
    }
    return room;
  } catch (err) {
    // Rows go with the room (cascade). The objects do not, so they are removed explicitly.
    await deleteRoom(room.id).catch(() => undefined);
    await deleteObjects(copiedKeys).catch(() => undefined);
    throw err;
  }
}
