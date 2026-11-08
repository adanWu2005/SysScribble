'use client';

import { MAX_CURSOR_CHAT_CHARS, REACTION_MS, awarenessStateSchema } from '@wb/shared';
import { useCallback, useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { Point } from '@/lib/whiteboard/geometry';
import type { View } from '@/lib/whiteboard/viewport';
import type { Peer } from './useBoard';

interface Burst {
  key: string;
  emoji: string;
  /** World position where it started, so it stays on the spot as the camera moves. */
  at: Point;
}

const MAX_BURSTS = 30;

/**
 * Reactions floating up from where someone's pointer was. Mine and everyone else's. Other people's
 * arrive through the awareness change event, so each new press spawns exactly one burst.
 */
export function useReactionBursts(awareness: Awareness): { bursts: Burst[]; spawn: (emoji: string, at: Point) => void } {
  const [bursts, setBursts] = useState<Burst[]>([]);

  const spawn = useCallback((emoji: string, at: Point) => {
    const key = crypto.randomUUID();
    setBursts((current) => [...current.slice(-(MAX_BURSTS - 1)), { key, emoji, at }]);
    setTimeout(() => setBursts((current) => current.filter((burst) => burst.key !== key)), REACTION_MS);
  }, []);

  useEffect(() => {
    const seen = new Map<number, number>();
    const onChange = () => {
      const present = new Set<number>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        present.add(clientId);
        // Remote awareness is untrusted, so it is checked like everywhere else.
        const parsed = awarenessStateSchema.safeParse(state);
        const reaction = parsed.success ? parsed.data.reaction : null;
        if (!parsed.success || !reaction || seen.get(clientId) === reaction.n) return;
        seen.set(clientId, reaction.n);
        const pointer = parsed.data.pointer;
        if (pointer) spawn(reaction.emoji, { x: pointer.x, y: pointer.y });
      });
      for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
    };
    awareness.on('change', onChange);
    return () => awareness.off('change', onChange);
  }, [awareness, spawn]);

  return { bursts, spawn };
}

interface EphemeralLayerProps {
  peers: readonly Peer[];
  bursts: readonly Burst[];
  view: View;
}

/**
 * Other people's cursor chat bubbles and the reaction bursts. Pure DOM and pointer-transparent.
 * The text comes from awareness, so it is untrusted: it renders as a text node and is clipped.
 */
export function EphemeralLayer({ peers, bursts, view }: EphemeralLayerProps) {
  const screenOf = (point: Point) => ({ x: point.x * view.scale + view.x, y: point.y * view.scale + view.y });

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {peers.map((peer) => {
        const text = peer.chat?.text.slice(0, MAX_CURSOR_CHAT_CHARS);
        if (!text || !peer.pointer) return null;
        const at = screenOf(peer.pointer);
        return (
          <span
            key={peer.clientId}
            style={{ left: at.x + 14, top: at.y + 16, backgroundColor: peer.user.color }}
            className="absolute max-w-[240px] truncate rounded-2xl rounded-tl-sm px-2.5 py-1 text-xs font-medium text-white shadow-md"
          >
            {text}
          </span>
        );
      })}
      {bursts.map((burst) => {
        const at = screenOf(burst.at);
        return (
          <span key={burst.key} style={{ left: at.x, top: at.y }} className="reaction-float absolute -translate-x-1/2 text-3xl">
            {burst.emoji}
          </span>
        );
      })}
    </div>
  );
}

interface CursorChatInputProps {
  /** Screen position to open at, near the pointer. */
  at: Point;
  color: string;
  onChange: (text: string) => void;
  /** Called on Enter or Escape. */
  onClose: () => void;
}

/** The box I type my own cursor chat into. What I type is broadcast as I go. */
export function CursorChatInput({ at, color, onChange, onClose }: CursorChatInputProps) {
  const [text, setText] = useState('');
  return (
    <input
      autoFocus
      aria-label="Cursor chat. Enter or Escape to close."
      value={text}
      maxLength={MAX_CURSOR_CHAT_CHARS}
      placeholder="Say something…"
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onBlur={onClose}
      style={{ left: at.x + 14, top: at.y + 16, backgroundColor: color }}
      className="absolute z-20 w-56 rounded-2xl rounded-tl-sm px-2.5 py-1 text-xs font-medium text-white shadow-md outline-none placeholder:text-white/70"
    />
  );
}
