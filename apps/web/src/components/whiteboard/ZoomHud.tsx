'use client';

import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { ToolButton } from './Toolbar';

interface ZoomHudProps {
  scale: number;
  minimapOpen: boolean;
  /** How many shapes are drawn out of how many exist. Shown only when culling hides some. */
  drawn: number;
  total: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  onToggleMinimap: () => void;
}

/** Bottom-right zoom controls. Anyone can use them, since they only move the local camera. */
export function ZoomHud({ scale, minimapOpen, drawn, total, onZoomIn, onZoomOut, onReset, onFit, onToggleMinimap }: ZoomHudProps) {
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-2xl border border-neutral-200 bg-white/95 p-1 shadow-md backdrop-blur dark:border-neutral-700 dark:bg-neutral-800/95"
    >
      {drawn < total ? (
        <span
          title="Shapes far off screen are not drawn until you pan to them."
          className="px-2 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400"
        >
          Drawing {drawn} of {total}
        </span>
      ) : null}
      <ToolButton label="Zoom out" onClick={onZoomOut}>
        <Minus size={16} aria-hidden />
      </ToolButton>
      <button
        type="button"
        aria-label="Reset zoom to 100%"
        onClick={(event) => {
          if (event.detail > 0) event.currentTarget.blur();
          onReset();
        }}
        className="h-8 min-w-[3.25rem] rounded-md px-1 text-xs font-medium tabular-nums text-neutral-700 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        {Math.round(scale * 100)}%
      </button>
      <ToolButton label="Zoom in" onClick={onZoomIn}>
        <Plus size={16} aria-hidden />
      </ToolButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-neutral-300 dark:bg-neutral-600" />
      <ToolButton label="Fit to screen" onClick={onFit}>
        <Maximize size={16} aria-hidden />
      </ToolButton>
      <ToolButton label="Minimap" pressed={minimapOpen} onClick={onToggleMinimap}>
        <MapIcon size={16} aria-hidden />
      </ToolButton>
    </div>
  );
}
