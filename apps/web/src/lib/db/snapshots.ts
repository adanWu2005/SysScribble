import 'server-only';
import { HISTORY_MAX_ENTRIES, type SnapshotSummary } from '@wb/shared';
import { byteaToBytes } from '@wb/shared/server';
import { ApiError } from '@/lib/api';
import { getAdminClient } from '@/lib/supabase/admin';

/** Postgres `program_limit_exceeded`, raised when a saved state is too large to keep. */
const TOO_LARGE = '54000';

/**
 * Newest first. The bytes are never selected here, so listing stays cheap. Callers have already
 * checked the caller's role for this exact room.
 */
export async function listSnapshots(roomId: string): Promise<SnapshotSummary[]> {
  const { data, error } = await getAdminClient()
    .from('room_snapshots')
    .select('id, version, size_bytes, label, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_MAX_ENTRIES);
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.map((row) => ({
    id: row.id,
    version: row.version,
    sizeBytes: row.size_bytes,
    label: row.label,
    createdAt: row.created_at,
  }));
}

/**
 * One entry's bytes. Filtered by room as well as id: an id from another room must look like it
 * does not exist, or an editor of room A could read room B's history.
 */
export async function getSnapshotBytes(roomId: string, snapshotId: string): Promise<Uint8Array | null> {
  const { data, error } = await getAdminClient()
    .from('room_snapshots')
    .select('yjs_snapshot')
    .eq('id', snapshotId)
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  if (!data) return null;
  try {
    return byteaToBytes(data.yjs_snapshot);
  } catch {
    throw new ApiError(500, 'INTERNAL', 'Stored snapshot is unreadable');
  }
}

/** Copies the room's saved state into history now. Returns the entry id, or null if nothing was saved. */
export async function recordCheckpoint(roomId: string, label: string): Promise<string | null> {
  const { data, error } = await getAdminClient().rpc('record_room_checkpoint', {
    p_room_id: roomId,
    p_label: label,
  });
  if (error) {
    if (error.code === TOO_LARGE) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'This workspace is too large to keep a restore point');
    }
    throw new ApiError(500, 'INTERNAL', 'Database error');
  }
  return data;
}
