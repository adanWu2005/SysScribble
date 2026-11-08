'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { INITIAL_VIEW, easeOutCubic, lerpView, type View } from '@/lib/whiteboard/viewport';

export interface Viewport {
  view: View;
  /** Jumps to a view, cancelling any animation in flight. */
  setView: (update: View | ((current: View) => View)) => void;
  /** Eases to a view. A new gesture cancels it. */
  animateTo: (target: View, durationMs?: number) => void;
  /** The latest view, for event handlers that run between renders. */
  getView: () => View;
}

export function useViewport(): Viewport {
  const [view, setViewState] = useState<View>(INITIAL_VIEW);
  const latest = useRef<View>(INITIAL_VIEW);
  const frame = useRef<number | null>(null);

  const commit = useCallback((next: View) => {
    latest.current = next;
    setViewState(next);
  }, []);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const setView = useCallback(
    (update: View | ((current: View) => View)) => {
      stop();
      commit(typeof update === 'function' ? update(latest.current) : update);
    },
    [commit, stop],
  );

  const animateTo = useCallback(
    (target: View, durationMs = 220) => {
      stop();
      const from = latest.current;
      const startedAt = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / durationMs);
        commit(lerpView(from, target, easeOutCubic(t)));
        frame.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      frame.current = requestAnimationFrame(step);
    },
    [commit, stop],
  );

  useEffect(() => stop, [stop]);

  const getView = useCallback(() => latest.current, []);

  return { view, setView, animateTo, getView };
}
