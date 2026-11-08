import 'server-only';
import { MAX_ROOM_STORAGE_BYTES, type Asset, type Tables } from '@wb/shared';
import { ApiError } from '@/lib/api';
import { getAdminClient } from '@/lib/supabase/admin';

type AssetRow = Tables<'room_assets'>;

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    roomId: row.room_id,
    uploadedBy: row.uploaded_by,
    objectKey: row.r2_object_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export interface AssetReservation {
  id: string;
  roomId: string;
  uploadedBy: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
}

/** Atomic quota check plus insert. False means the room is out of storage. */
export async function reserveAsset(reservation: AssetReservation): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc('reserve_room_asset', {
    p_id: reservation.id,
    p_room_id: reservation.roomId,
    p_uploaded_by: reservation.uploadedBy,
    p_key: reservation.objectKey,
    p_mime: reservation.mimeType,
    p_size: reservation.sizeBytes,
    p_quota: MAX_ROOM_STORAGE_BYTES,
  });
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data;
}

/** Filters by room as well as id: an id from another room must look like it does not exist. */
export async function findAsset(roomId: string, assetId: string): Promise<Asset | null> {
  const { data, error } = await getAdminClient()
    .from('room_assets')
    .select('*')
    .eq('id', assetId)
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data ? toAsset(data) : null;
}

export async function listAssets(roomId: string): Promise<Asset[]> {
  const { data, error } = await getAdminClient()
    .from('room_assets')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.map(toAsset);
}

export async function listAssetKeys(roomId: string): Promise<string[]> {
  const { data, error } = await getAdminClient().from('room_assets').select('r2_object_key').eq('room_id', roomId);
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.map((row) => row.r2_object_key);
}

export async function deleteAssetRow(roomId: string, assetId: string): Promise<void> {
  const { error } = await getAdminClient().from('room_assets').delete().eq('id', assetId).eq('room_id', roomId);
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
}
