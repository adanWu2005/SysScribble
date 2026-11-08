import 'server-only';
import { presenceKey, sumPresence } from '@wb/shared';
import { getRedis } from '@/lib/redis';

/** The most rooms one dashboard asks about, so a request is one bounded pipeline. */
const MAX_ROOMS = 100;

/**
 * How many people are connected to each room right now, summed over every WebSocket instance.
 * Rooms nobody is in are left out. This is a nicety: if Redis cannot be read the answer is
 * "nobody", never an error.
 */
export async function readRoomPresence(roomIds: readonly string[]): Promise<Record<string, number>> {
  const ids = roomIds.slice(0, MAX_ROOMS);
  if (ids.length === 0) return {};
  try {
    const pipeline = getRedis().pipeline();
    for (const id of ids) pipeline.hgetall(presenceKey(id));
    const results = await pipeline.exec<(Record<string, unknown> | null)[]>();
    const now = Date.now();
    const present: Record<string, number> = {};
    ids.forEach((id, index) => {
      const total = sumPresence(results[index], now);
      if (total > 0) present[id] = total;
    });
    return present;
  } catch (err) {
    console.error('[presence] read failed', err instanceof Error ? err.message : err);
    return {};
  }
}
