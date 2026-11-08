/** How the room is laid out: which pane shows and how wide the notes are. Per browser, never shared. */

export type ViewMode = 'notes' | 'split' | 'canvas';

export interface LayoutPrefs {
  mode: ViewMode;
  /** The notes pane's share of the width in split view, from MIN_SPLIT to MAX_SPLIT. */
  split: number;
}

export const DEFAULT_PREFS: LayoutPrefs = { mode: 'split', split: 0.4 };
export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;
/** Neither pane may be squeezed below these widths, however the handle is dragged. */
const MIN_NOTES_PX = 280;
const MIN_CANVAS_PX = 320;

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREFS.split;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

function isMode(value: unknown): value is ViewMode {
  return value === 'notes' || value === 'split' || value === 'canvas';
}

/** Reads stored preferences. Anything missing or malformed falls back to the default for that field. */
export function parsePrefs(raw: string | null): LayoutPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_PREFS;
    const record = value as Record<string, unknown>;
    return {
      mode: isMode(record['mode']) ? record['mode'] : DEFAULT_PREFS.mode,
      split: typeof record['split'] === 'number' ? clampSplit(record['split']) : DEFAULT_PREFS.split,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function serializePrefs(prefs: LayoutPrefs): string {
  return JSON.stringify({ mode: prefs.mode, split: clampSplit(prefs.split) });
}

/** Turns a pointer position into a split fraction, keeping both panes usable. */
export function splitFromPointer(pointerX: number, containerLeft: number, containerWidth: number): number {
  if (containerWidth <= 0) return DEFAULT_PREFS.split;
  const min = Math.max(MIN_SPLIT, MIN_NOTES_PX / containerWidth);
  const max = Math.min(MAX_SPLIT, 1 - MIN_CANVAS_PX / containerWidth);
  const raw = (pointerX - containerLeft) / containerWidth;
  // A very narrow window can make min exceed max. Then the safe answer is the middle.
  if (min > max) return 0.5;
  return Math.min(max, Math.max(min, raw));
}
