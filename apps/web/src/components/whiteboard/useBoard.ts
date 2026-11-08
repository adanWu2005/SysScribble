'use client';

import { awarenessStateSchema, type AwarenessState, type Shape } from '@wb/shared';
import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { orderRoot, readShapes, shapesRoot } from '@/lib/whiteboard/model';

/** Live, schema-checked shapes. Re-renders at most once per animation frame. */
export function useShapes(doc: Y.Doc): Shape[] {
  const [shapes, setShapes] = useState<Shape[]>(() => readShapes(doc));

  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        setShapes(readShapes(doc));
      });
    };
    const root = shapesRoot(doc);
    const order = orderRoot(doc);
    root.observeDeep(refresh);
    order.observe(refresh);
    refresh();
    return () => {
      root.unobserveDeep(refresh);
      order.unobserve(refresh);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [doc]);

  return shapes;
}

export interface Peer extends AwarenessState {
  clientId: number;
}

/** Other people in the room. Remote awareness is untrusted, so each state is validated. */
export function usePeers(awareness: Awareness | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!awareness) return undefined;
    const refresh = () => {
      const next: Peer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const parsed = awarenessStateSchema.safeParse(state);
        if (parsed.success) next.push({ ...parsed.data, clientId });
      });
      setPeers(next);
    };
    awareness.on('change', refresh);
    refresh();
    return () => awareness.off('change', refresh);
  }, [awareness]);

  // Without a session there is nobody to show, whatever was seen before.
  return awareness ? peers : [];
}

export interface RosterEntry {
  clientId: number;
  user: AwarenessState['user'];
  ghost: boolean;
}

function sameRoster(a: readonly RosterEntry[], b: readonly RosterEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        entry.clientId === other.clientId &&
        entry.user.id === other.user.id &&
        entry.user.name === other.user.name &&
        entry.user.color === other.user.color &&
        entry.ghost === other.ghost
      );
    })
  );
}

/**
 * Who is in the room, without the live cursor data. It updates only when somebody joins,
 * leaves or renames, so a header built on it does not re-render on every mouse move.
 */
export function usePeerRoster(awareness: Awareness): RosterEntry[] {
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  useEffect(() => {
    const refresh = () => {
      const next: RosterEntry[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const parsed = awarenessStateSchema.safeParse(state);
        if (parsed.success) next.push({ clientId, user: parsed.data.user, ghost: parsed.data.ghost === true });
      });
      setRoster((current) => (sameRoster(current, next) ? current : next));
    };
    awareness.on('change', refresh);
    refresh();
    return () => awareness.off('change', refresh);
  }, [awareness]);

  return roster;
}
