'use client';

import {
  SUMMARY_MAX_IDS,
  presenceResponseSchema,
  roomSummariesResponseSchema,
  type RoomSummary,
} from '@wb/shared';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/fetcher';

const PRESENCE_POLL_MS = 30_000;

/**
 * What the cards show beyond the room row: thumbnails and member names, loaded a dozen at a time
 * for the rooms on screen, and the live headcount, refreshed twice a minute while the tab is
 * visible. Both are extras: a failure leaves the card plain, never broken. Everything the server
 * sends is checked against its schema before it is used.
 */
export function useDashboardData(visibleIds: readonly string[]): {
  summaries: ReadonlyMap<string, RoomSummary>;
  presence: Readonly<Record<string, number>>;
} {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, RoomSummary>>(new Map());
  const [presence, setPresence] = useState<Readonly<Record<string, number>>>({});
  const asked = useRef(new Set<string>());

  // Thumbnails: ask for rooms not yet asked about. A room is asked about once per page load.
  const idsKey = visibleIds.join(',');
  useEffect(() => {
    const wanted = idsKey === '' ? [] : idsKey.split(',');
    const askedIds = asked.current;
    const fresh = wanted.filter((id) => !askedIds.has(id));
    if (fresh.length === 0) return;
    let cancelled = false;
    const finished = new Set<string>();
    void (async () => {
      for (let i = 0; i < fresh.length; i += SUMMARY_MAX_IDS) {
        const batch = fresh.slice(i, i + SUMMARY_MAX_IDS);
        for (const id of batch) askedIds.add(id);
        try {
          const raw = await apiFetch<unknown>(`/api/rooms/summaries?ids=${batch.join(',')}`);
          const parsed = roomSummariesResponseSchema.safeParse(raw);
          if (!parsed.success || cancelled) continue;
          for (const id of batch) finished.add(id);
          setSummaries((current) => {
            const next = new Map(current);
            for (const summary of parsed.data.summaries) next.set(summary.roomId, summary);
            return next;
          });
        } catch {
          // The card stays plain. It is asked about again on the next page load.
        }
      }
    })();
    return () => {
      cancelled = true;
      // A batch that never finished was not stored, so it must be asked for again.
      for (const id of fresh) if (!finished.has(id)) askedIds.delete(id);
    };
  }, [idsKey]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const parsed = presenceResponseSchema.safeParse(await apiFetch<unknown>('/api/rooms/presence'));
        if (parsed.success && !stopped) setPresence(parsed.data.presence);
      } catch {
        // No pill this time round.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), PRESENCE_POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { summaries, presence };
}
