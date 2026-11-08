'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A string kept in localStorage, shared by every component that uses the same key and by other
 * tabs. The server render and the first browser render see `null`, and the stored value takes
 * over right after, so they always agree. Storage can be blocked, so the latest value is also
 * kept in memory.
 */
const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  const held = memory.get(key);
  if (held !== undefined) return held;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalPref(key: string): [string | null, (value: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(key, set);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          memory.delete(key);
          listener();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        set.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  const write = useCallback(
    (next: string) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Blocked storage: the value still holds until the tab closes.
      }
      for (const listener of listeners.get(key) ?? []) listener();
    },
    [key],
  );

  return [value, write];
}
