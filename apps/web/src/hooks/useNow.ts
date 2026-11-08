'use client';

import { useSyncExternalStore } from 'react';

/**
 * The current time, refreshed every minute, for "5 minutes ago" labels. It is null on the server
 * and during the first browser render, so the two agree; the real time arrives right after.
 */
let current = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, 60_000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (current === 0 ? Date.now() : current),
    () => null,
  );
}
