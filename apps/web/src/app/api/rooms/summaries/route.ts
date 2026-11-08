import { SUMMARY_MAX_IDS, uuidSchema } from '@wb/shared';
import { z } from 'zod';
import { ApiError, json, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { listRoomsForUser } from '@/lib/db/rooms';
import { summariesFor } from '@/lib/db/summaries';
import { enforceRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ids: z
    .string()
    .max(SUMMARY_MAX_IDS * 37)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(uuidSchema).min(1).max(SUMMARY_MAX_IDS)),
});

/**
 * GET /api/rooms/summaries?ids=a,b,c — thumbnails and member counts for dashboard cards.
 * Every id is checked as a UUID, then intersected with the caller's own memberships: an id of a
 * room they are not in is dropped without a word, and looks the same as one that does not exist.
 */
export const GET = route(async ({ req }) => {
  const parsed = querySchema.safeParse({ ids: req.nextUrl.searchParams.get('ids') ?? '' });
  if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Invalid room ids');
  const user = await requireUser(req);
  await enforceRateLimit('roomSummaries', user.userId);

  const mine = new Set((await listRoomsForUser(user.userId)).map((room) => room.id));
  const allowed = Array.from(new Set(parsed.data.ids)).filter((id) => mine.has(id));
  return json({ summaries: await summariesFor(allowed) });
});
