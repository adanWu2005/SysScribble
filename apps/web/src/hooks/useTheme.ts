'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { THEME_KEY, parseThemePref, resolveTheme, type ThemePref } from '@/lib/theme/theme';

/**
 * The saved choice lives in an external store so the server render and the first browser render
 * agree (system), and the stored value takes over right after. Storage can be blocked, so the
 * latest choice is also kept in memory.
 */
let memory: ThemePref | null = null;
const listeners = new Set<() => void>();

function readStored(): ThemePref {
  try {
    return parseThemePref(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

function getSnapshot(): ThemePref {
  return memory ?? readStored();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) {
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

function applyToDocument(pref: ThemePref): void {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveTheme(pref, systemDark) === 'dark');
}

/** The theme choice, and a setter that saves and applies it. */
export function useTheme(): { pref: ThemePref; setPref: (pref: ThemePref) => void } {
  const pref = useSyncExternalStore(subscribe, getSnapshot, () => 'system' as const);

  // Keeps the page in step with the choice, and with the system while the choice is "system".
  useEffect(() => {
    applyToDocument(pref);
    if (pref !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyToDocument('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    memory = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Blocked storage: the choice still holds until the tab closes.
    }
    for (const listener of listeners) listener();
  }, []);

  return { pref, setPref };
}

function subscribeDark(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** True while the page is in dark mode, for the canvas, whose colors are not CSS. */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribeDark,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
}
