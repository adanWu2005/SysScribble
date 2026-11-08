'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { keyToAction, type ShortcutAction } from '@/lib/whiteboard/shortcuts';

/** Typing in the notes editor or a text box must never trigger a board shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Board shortcuts on the whole window, switched off while a text field has focus. */
export function useHotkeys(canEdit: boolean, enabled: boolean, onAction: (action: ShortcutAction) => void): void {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (!enabled || isEditableTarget(event.target)) return;
    const action = keyToAction(event, { canEdit });
    if (!action) return;
    event.preventDefault();
    onAction(action);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}

/** True while the space bar is held, which turns a drag into a pan. */
export function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) return;
      // Stops the page from scrolling and a focused button from being clicked.
      event.preventDefault();
      setHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setHeld(false);
    };
    const release = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, []);

  return held;
}
