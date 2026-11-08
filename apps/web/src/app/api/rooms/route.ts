import { createRoomSchema, type RoomWithRole } from '@wb/shared';
import { ApiError, json, parseBody, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { createRoom, deleteRoom, listRoomsForUser, setInitialSnapshot } from '@/lib/db/rooms';
import { enforceRateLimit } from '@/lib/ratelimit';
import { buildTemplateSnapshot } from '@/lib/templates/build';

export const dynamic = 'force-dynamic';

/** GET /api/rooms — rooms the caller belongs to, with their role. */
export const GET = route(async ({ req }) => {
  const user = await requireUser(req);
  const rooms: RoomWithRole[] = await listRoomsForUser(user.userId);
  return json({ rooms });
});

/** POST /api/rooms — create a room, optionally from a template; caller becomes OWNER atomically. */
export const POST = route(async ({ req }) => {
  const user = await requireUser(req);
  await enforceRateLimit('roomCreate', user.userId);
  const body = await parseBody(req, createRoomSchema);
  const room = await createRoom(user.userId, body.title);

  // The template is a name from a closed list. The document is built here, never taken from the client.
  const template = body.template ?? 'blank';
  if (template !== 'blank') {
    try {
      const author = (user.email?.split('@')[0] ?? '').slice(0, 80) || 'Team';
      const bytes = buildTemplateSnapshot(template, room.title, author);
      if (bytes) await setInitialSnapshot(room.id, bytes);
    } catch {
      // A half-made room would open empty while the person expects a template, so it is removed.
      await deleteRoom(room.id).catch(() => undefined);
      throw new ApiError(500, 'INTERNAL', 'Could not set up the template');
    }
  }
  return json({ room, role: 'OWNER' as const }, { status: 201 });
});
