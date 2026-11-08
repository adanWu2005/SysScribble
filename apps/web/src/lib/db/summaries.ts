import 'server-only';
import { MAX_SNAPSHOT_BYTES, type RoomSummary } from '@wb/shared';
import { byteaToBytes } from '@wb/shared/server';
import * as Y from 'yjs';
import { ApiError } from '@/lib/api';
import { boardToSvg } from '@/lib/export/svg';
import { getAdminClient } from '@/lib/supabase/admin';
import { readShapes } from '@/lib/whiteboard/model';

/** A thumbnail is a hint, so a big board is drawn from its first shapes rather than all of them. */
const THUMBNAIL_MAX_SHAPES = 300;
const THUMBNAIL_MAX_CHARS = 100_000;
/** Snapshots over this are not decoded for a card; the card shows only its counts. */
const THUMBNAIL_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const PEOPLE_SHOWN = 3;

function thumbnailOf(doc: Y.Doc): { shapeCount: number; thumbnail: string | null } {
  const shapes = readShapes(doc);
  const drawn = boardToSvg(shapes.slice(0, THUMBNAIL_MAX_SHAPES), { padding: 24, background: null });
  if (!drawn || drawn.svg.length > THUMBNAIL_MAX_CHARS) return { shapeCount: shapes.length, thumbnail: null };
  // Shown through an <img>, where a script in an SVG never runs. The SVG is also built only from
  // validated shapes with every string escaped, so this is a second wall, not the only one.
  return { shapeCount: shapes.length, thumbnail: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}` };
}

function decode(bytes: Uint8Array | null): { shapeCount: number; thumbnail: string | null } {
  if (!bytes || bytes.length === 0 || bytes.length > Math.min(THUMBNAIL_MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_BYTES)) {
    return { shapeCount: 0, thumbnail: null };
  }
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    return thumbnailOf(doc);
  } catch {
    // A damaged snapshot must not break the dashboard.
    return { shapeCount: 0, thumbnail: null };
  } finally {
    doc.destroy();
  }
}

/**
 * Card details for rooms the caller has ALREADY been shown to belong to. The route intersects the
 * requested ids with the caller's memberships first; nothing here re-checks access.
 */
export async function summariesFor(roomIds: readonly string[]): Promise<RoomSummary[]> {
  if (roomIds.length === 0) return [];
  const admin = getAdminClient();

  const rooms = await admin.from('rooms').select('id, yjs_snapshot').in('id', [...roomIds]);
  if (rooms.error) throw new ApiError(500, 'INTERNAL', 'Database error');

  const members = await admin
    .from('room_members')
    .select('room_id, user_id')
    .in('room_id', [...roomIds])
    .order('joined_at', { ascending: true });
  if (members.error) throw new ApiError(500, 'INTERNAL', 'Database error');

  const byRoom = new Map<string, string[]>();
  for (const row of members.data) byRoom.set(row.room_id, [...(byRoom.get(row.room_id) ?? []), row.user_id]);

  const shownUsers = Array.from(new Set(Array.from(byRoom.values()).flatMap((users) => users.slice(0, PEOPLE_SHOWN))));
  const names = new Map<string, string>();
  if (shownUsers.length > 0) {
    const profiles = await admin.from('profiles').select('id, display_name, email').in('id', shownUsers);
    if (profiles.error) throw new ApiError(500, 'INTERNAL', 'Database error');
    for (const p of profiles.data) names.set(p.id, p.display_name?.trim() || p.email?.split('@')[0] || 'Member');
  }

  return rooms.data.map((row) => {
    const users = byRoom.get(row.id) ?? [];
    const snapshot = row.yjs_snapshot ? byteaToBytes(row.yjs_snapshot) : null;
    return {
      roomId: row.id,
      ...decode(snapshot),
      memberCount: users.length,
      people: users.slice(0, PEOPLE_SHOWN).map((id) => (names.get(id) ?? 'Member').slice(0, 80)),
    };
  });
}
