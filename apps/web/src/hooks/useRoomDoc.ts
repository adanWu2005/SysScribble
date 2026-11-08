'use client';

import { canMutate, type RoomRole } from '@wb/shared';
import { RoomProvider, type ProviderStatus, type SocketLike } from '@wb/shared/client';
import { useEffect, useState } from 'react';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { publicEnv } from '@/lib/env';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface RoomUser {
  id: string;
  name: string;
  color: string;
}

export interface RoomSession {
  doc: Y.Doc;
  awareness: Awareness;
  provider: RoomProvider;
}

export interface RoomConnection {
  session: RoomSession | null;
  status: ProviderStatus;
  /** Live role from the server, which may differ from the role at page load. */
  role: RoomRole;
  synced: boolean;
  /** Round-trip time to the realtime server in ms, or null while offline. */
  latency: number | null;
  /** Set when the server ended the session for good. */
  terminatedCode: number | null;
}

export function useRoomDoc(roomId: string, user: RoomUser, initialRole: RoomRole): RoomConnection {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [status, setStatus] = useState<ProviderStatus>('connecting');
  const [role, setRole] = useState<RoomRole>(initialRole);
  const [synced, setSynced] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [terminatedCode, setTerminatedCode] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState({ user });
    const supabase = createSupabaseBrowserClient();

    const provider = new RoomProvider({
      url: publicEnv.NEXT_PUBLIC_WS_URL,
      roomId,
      doc,
      awareness,
      connect: false,
      getToken: async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('No session');
        return data.session.access_token;
      },
      createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    });

    let currentRole: RoomRole | null = null;
    const unsubscribe = [
      provider.on('status', setStatus),
      provider.on('synced', setSynced),
      provider.on('latency', setLatency),
      provider.on('terminated', setTerminatedCode),
      provider.on('role', (next) => {
        const lostWrite = currentRole !== null && canMutate(currentRole) && !canMutate(next);
        currentRole = next;
        setRole(next);
        // Edits in flight during a downgrade were dropped by the server, so this copy of
        // the document has diverged. Rebuilding it shows what everyone else sees.
        if (lostWrite) setGeneration((value) => value + 1);
      }),
    ];

    // The session owns a live socket, so it can only be created inside an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ doc, awareness, provider });
    provider.connect();

    return () => {
      for (const stop of unsubscribe) stop();
      setSession(null);
      provider.destroy();
      awareness.destroy();
      doc.destroy();
    };
  }, [roomId, user, generation]);

  return { session, status, role, synced, latency, terminatedCode };
}
