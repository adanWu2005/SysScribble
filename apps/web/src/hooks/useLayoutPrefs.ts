'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { clampSplit, parsePrefs, serializePrefs, type LayoutPrefs, type ViewMode } from '@/lib/layout/prefs';

const KEY = 'wb:layout';

/**
 * The layout is remembered per browser. It is kept in an external store rather than in state so
 * the first render on the server and in the browser agree (the default), and the stored value
 * takes over right after. Storage can be blocked, so the latest value is also held in memory.
 */
let memory: string | null = null;
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): string | null {
  return memory ?? readStored();
}

function getServerSnapshot(): string | null {
  return null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    // Another tab changed it. Forget the local copy so that change shows.
    if (event.key === KEY || event.key === null) {
      memory = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function write(prefs: LayoutPrefs): void {
  const raw = serializePrefs(prefs);
  memory = raw;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Private mode or blocked storage: the layout still works for this tab.
  }
  for (const listener of listeners) listener();
}

export interface LayoutControls {
  prefs: LayoutPrefs;
  setMode: (mode: ViewMode) => void;
  setSplit: (split: number) => void;
}

export function useLayoutPrefs(): LayoutControls {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const prefs = useMemo(() => parsePrefs(raw), [raw]);

  const setMode = useCallback(
    (mode: ViewMode) => write({ ...parsePrefs(getSnapshot()), mode }),
    [],
  );
  const setSplit = useCallback(
    (split: number) => write({ ...parsePrefs(getSnapshot()), split: clampSplit(split) }),
    [],
  );

  return { prefs, setMode, setSplit };
}
