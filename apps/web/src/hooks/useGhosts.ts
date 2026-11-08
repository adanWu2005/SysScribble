'use client';

import type { SocketLike } from '@wb/shared/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { publicEnv } from '@/lib/env';
import { GhostClient, type GhostAnchor } from '@/lib/ghost/GhostClient';
import { MAX_GHOSTS, freeGhostIndex, ghostColor, ghostName } from '@/lib/ghost/behavior';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RoomSession } from './useRoomDoc';

export interface GhostInfo {
  index: number;
  name: string;
  color: string;
}

export interface Ghosts {
  ghosts: readonly GhostInfo[];
  /** True while another ghost can be added. */
  canSpawn: boolean;
  spawn: () => void;
  /** Stops every ghost. With `removeContent`, each tidies up the notes and stickies it added. */
  stopAll: (removeContent: boolean) => Promise<void>;
  /** The most ghosts at once. */
  max: number;
}

/**
 * Starts and stops the Chaos Lab's ghost collaborators. They live here, in the room, and not in
 * the panel, so closing the panel does not stop them. Each is a real second client of the server.
 */
export function useGhosts(roomId: string, userId: string, session: RoomSession | null): Ghosts {
  const clients = useRef(new Map<number, GhostClient>());
  const [ghosts, setGhosts] = useState<GhostInfo[]>([]);
  // Read by the ghosts each beat, so they circle wherever the real user is looking now.
  const anchor = useRef<GhostAnchor>({ x: 0, y: 0, scale: 1 });

  // The ghosts circle wherever the real user is looking. The canvas publishes that as `viewport`.
  useEffect(() => {
    if (!session) return undefined;
    const awareness = session.awareness;
    const update = () => {
      const viewport = awareness.getLocalState()?.['viewport'] as { cx?: unknown; cy?: unknown; scale?: unknown } | null | undefined;
      if (typeof viewport?.cx === 'number' && typeof viewport.cy === 'number' && typeof viewport.scale === 'number') {
        anchor.current = { x: viewport.cx, y: viewport.cy, scale: viewport.scale };
      }
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [session]);

  const publish = useCallback(() => {
    setGhosts(
      Array.from(clients.current.keys())
        .sort((a, b) => a - b)
        .map((index) => ({ index, name: ghostName(index), color: ghostColor(index) })),
    );
  }, []);

  const spawn = useCallback(() => {
    const index = freeGhostIndex(clients.current.keys());
    if (index === null) return;
    const supabase = createSupabaseBrowserClient();
    const ghost = new GhostClient({
      index,
      userId,
      roomId,
      url: publicEnv.NEXT_PUBLIC_WS_URL,
      getToken: async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('No session');
        return data.session.access_token;
      },
      createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      getAnchor: () => anchor.current,
      // The server ended this ghost's session (removed, kicked, room deleted): drop it quietly.
      onTerminated: () => {
        clients.current.delete(index);
        void ghost.stop(false);
        publish();
      },
    });
    clients.current.set(index, ghost);
    ghost.start();
    publish();
  }, [roomId, userId, publish]);

  const stopAll = useCallback(
    async (removeContent: boolean) => {
      const running = Array.from(clients.current.values());
      clients.current.clear();
      publish();
      await Promise.all(running.map((ghost) => ghost.stop(removeContent)));
    },
    [publish],
  );

  // Leaving the room must not leave ghosts running, nor their content behind.
  useEffect(() => {
    const running = clients.current;
    return () => {
      for (const ghost of running.values()) void ghost.stop(true);
      running.clear();
    };
  }, []);

  return { ghosts, canSpawn: ghosts.length < MAX_GHOSTS, spawn, stopAll, max: MAX_GHOSTS };
}
