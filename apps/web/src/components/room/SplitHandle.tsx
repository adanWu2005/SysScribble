'use client';

import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { DEFAULT_PREFS, MAX_SPLIT, MIN_SPLIT, clampSplit, splitFromPointer } from '@/lib/layout/prefs';

const KEY_STEP = 0.02;

interface SplitHandleProps {
  /** The notes pane's share of the width, from 0.2 to 0.8. */
  value: number;
  /** The element the two panes sit in, which the pointer position is measured against. */
  container: RefObject<HTMLElement | null>;
  /** Called while dragging, so the panes follow the pointer without saving every pixel. */
  onDrag: (value: number | null) => void;
  /** Called once with the final value. */
  onCommit: (value: number) => void;
}

/**
 * The draggable divider between notes and whiteboard. Drag with a mouse or finger, or focus it
 * and use the arrow keys. Double-click or press Enter to go back to the default width.
 */
export function SplitHandle({ value, container, onDrag, onCommit }: SplitHandleProps) {
  const dragging = useRef(false);
  const latest = useRef(value);

  function measure(event: PointerEvent<HTMLDivElement>): number | null {
    const rect = container.current?.getBoundingClientRect();
    return rect ? splitFromPointer(event.clientX, rect.left, rect.width) : null;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // Capture keeps the drag alive when the pointer crosses the whiteboard, which has its own handlers.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    latest.current = value;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const next = measure(event);
    if (next === null) return;
    latest.current = next;
    onDrag(next);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onDrag(null);
    onCommit(latest.current);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') onCommit(clampSplit(value - KEY_STEP));
    else if (event.key === 'ArrowRight') onCommit(clampSplit(value + KEY_STEP));
    else if (event.key === 'Enter' || event.key === 'Home') onCommit(DEFAULT_PREFS.split);
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize notes and whiteboard"
      aria-valuemin={Math.round(MIN_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_SPLIT * 100)}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(DEFAULT_PREFS.split)}
      className="group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-neutral-200 outline-none transition-colors hover:bg-blue-400 focus-visible:bg-blue-500 dark:bg-neutral-800 dark:hover:bg-blue-500 md:block"
    >
      {/* A wider invisible target, because 6px is hard to grab. */}
      <span aria-hidden className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
