import 'server-only';
import { ApiError } from '@/lib/api';
import { getAdminClient } from '@/lib/supabase/admin';

/** Rows read per page. PostgREST returns at most 1000 rows a request, so a bigger read would be cut short. */
const PAGE = 1000;
/** A safety stop, far beyond any real account, so one request can never page forever. */
const MAX_PAGES = 50;

/**
 * Total bytes of uploaded media across the given rooms. The caller passes only rooms the user
 * belongs to. Returns a sum and nothing about which room or file it came from.
 */
export async function sumMediaBytes(roomIds: readonly string[]): Promise<number> {
  if (roomIds.length === 0) return 0;
  const admin = getAdminClient();
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from('room_assets')
      .select('size_bytes')
      .in('room_id', [...roomIds])
      .order('id')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
    for (const row of data) total += Number(row.size_bytes);
    if (data.length < PAGE) break;
  }
  return total;
}
