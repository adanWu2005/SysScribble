import { uuidSchema } from '@wb/shared';
import { useSyncExternalStore } from 'react';

/**
 * Who is speaking in the huddle, as user ids. The huddle panel writes it; the avatars and the
 * canvas cursors read it, because they live outside the LiveKit room's React context.
 *
 * A LiveKit identity is the user id, set by the server when it mints the token, so a client
 * cannot claim to be someone else's voice. Anything that is not a UUID is ignored anyway.
 */

const EMPTY: ReadonlySet<string> = new Set();
let speaking: ReadonlySet<string> = EMPTY;
const listeners = new Set<() => void>();

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Replaces the speaking set. Listeners only hear about real changes. */
export function setSpeakers(identities: readonly string[]): void {
  const next = new Set(identities.filter((identity) => uuidSchema.safeParse(identity).success));
  if (sameMembers(speaking, next)) return;
  speaking = next.size === 0 ? EMPTY : next;
  for (const listener of listeners) listener();
}

export function clearSpeakers(): void {
  setSpeakers([]);
}

export function subscribeSpeaking(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getSpeakingIds(): ReadonlySet<string> {
  return speaking;
}

/** The user ids currently speaking. The same object is returned until it changes. */
export function useSpeakingIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeSpeaking, getSpeakingIds, () => EMPTY);
}
