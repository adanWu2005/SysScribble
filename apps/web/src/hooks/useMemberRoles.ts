'use client';

import { memberListResponseSchema, type RoomRole } from '@wb/shared';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/fetcher';

const REFRESH_MS = 30_000;

/**
 * The room's roles, for the badges in the avatar stack.
 *
 * A role is never taken from awareness, because awareness is self-reported and a user could
 * claim to be the owner. The roles come from the members API, which reads the database. They
 * are fetched when the set of people changes, when my own role changes, and every 30 seconds
 * while anyone else is here, since a role change by the owner does not reach other browsers.
 */
export function useMemberRoles(
  roomId: string,
  peerUserIds: readonly string[],
  ownRole: RoomRole,
): ReadonlyMap<string, RoomRole> {
  const [roles, setRoles] = useState<ReadonlyMap<string, RoomRole>>(() => new Map());
  const key = Array.from(new Set(peerUserIds)).sort().join(',');

  useEffect(() => {
    if (key === '') return undefined;
    let active = true;
    const load = () => {
      apiFetch<unknown>(`/api/rooms/${roomId}/members`)
        .then((raw) => {
          const parsed = memberListResponseSchema.safeParse(raw);
          if (active && parsed.success) setRoles(new Map(parsed.data.members.map((m) => [m.userId, m.role])));
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [roomId, key, ownRole]);

  return roles;
}
