'use client';

import type { Shape } from '@wb/shared';
import { BringToFront, Copy, Group, Link2, NotebookPen, SendToBack, Trash2, Ungroup } from 'lucide-react';
import type { Box } from '@/lib/whiteboard/geometry';
import {
  FILL_PALETTE,
  STROKE_PALETTE,
  STROKE_WIDTHS,
  styleValue,
  supportsStyle,
  type StyleKey,
} from '@/lib/whiteboard/style';
import type { Size } from '@/lib/whiteboard/viewport';
import { ToolButton } from './Toolbar';

interface PropertyBarProps {
  selected: readonly Shape[];
  /** Selection bounds in screen pixels. */
  anchor: Box;
  container: Size;
  onStyle: (key: StyleKey, value: string | number) => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Offered only when the selection can be grouped, or has a group to release. */
  onGroup?: () => void;
  onUngroup?: () => void;
  /** Offered for a single shape only. Left out when the notes cannot be edited. */
  onInsertInNotes?: () => void;
  onCopyLink?: () => void;
}

const BAR_HEIGHT = 44;
const GAP = 12;

function Swatches({
  label,
  colors,
  current,
  onPick,
}: {
  label: string;
  colors: readonly string[];
  current: string | number | undefined;
  onPick: (color: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${label} ${color}`}
          aria-pressed={current === color}
          onClick={() => onPick(color)}
          style={{ backgroundColor: color }}
          className={`h-5 w-5 rounded-full border border-neutral-300 dark:border-neutral-600 ${
            current === color ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-white dark:ring-offset-neutral-800' : ''
          }`}
        />
      ))}
    </div>
  );
}

function Separator() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-neutral-300 dark:bg-neutral-600" />;
}

/**
 * Style popover above the selection. It shows only the controls that apply to something in
 * the selection and writes through the same batch update as every other edit.
 */
export function PropertyBar({
  selected,
  anchor,
  container,
  onStyle,
  onFront,
  onBack,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onInsertInNotes,
  onCopyLink,
}: PropertyBarProps) {
  const first = selected[0];
  if (!first) return null;
  const has = (key: StyleKey) => selected.some((shape) => supportsStyle(shape, key));
  const same = (key: StyleKey) => {
    const target = selected.find((shape) => supportsStyle(shape, key));
    return target ? styleValue(target, key) : undefined;
  };

  // Above the selection, or below it when there is no room, and kept inside the canvas.
  const above = anchor.y - BAR_HEIGHT - GAP;
  const top = above >= 8 ? above : Math.min(container.height - BAR_HEIGHT - 8, anchor.y + anchor.height + GAP);
  const center = anchor.x + anchor.width / 2;
  const left = Math.min(Math.max(center, 160), Math.max(160, container.width - 160));

  return (
    <div
      role="toolbar"
      aria-label="Style"
      style={{ left, top }}
      className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-neutral-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-800/95"
    >
      {has('fill') ? (
        <Swatches label="Fill" colors={FILL_PALETTE} current={same('fill')} onPick={(color) => onStyle('fill', color)} />
      ) : null}
      {has('fill') && has('stroke') ? <Separator /> : null}
      {has('stroke') ? (
        <Swatches label="Stroke" colors={STROKE_PALETTE} current={same('stroke')} onPick={(color) => onStyle('stroke', color)} />
      ) : null}
      {has('strokeWidth') ? (
        <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="sr-only">Stroke width</span>
          <select
            value={String(same('strokeWidth') ?? '')}
            onChange={(event) => onStyle('strokeWidth', Number(event.target.value))}
            className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-600"
          >
            {same('strokeWidth') === undefined ? <option value="">Width</option> : null}
            {STROKE_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {width}px
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Separator />
      <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
        <span>Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={Number(same('opacity') ?? 1)}
          onChange={(event) => onStyle('opacity', Number(event.target.value))}
          className="w-20"
        />
      </label>
      <Separator />
      {selected.length === 1 && (onInsertInNotes || onCopyLink) ? (
        <>
          {onInsertInNotes ? (
            <ToolButton label="Insert in notes" onClick={onInsertInNotes}>
              <NotebookPen size={16} aria-hidden />
            </ToolButton>
          ) : null}
          {onCopyLink ? (
            <ToolButton label="Copy link to shape" onClick={onCopyLink}>
              <Link2 size={16} aria-hidden />
            </ToolButton>
          ) : null}
          <Separator />
        </>
      ) : null}
      {onGroup ? (
        <ToolButton label="Group" shortcut="Ctrl+G" onClick={onGroup}>
          <Group size={16} aria-hidden />
        </ToolButton>
      ) : null}
      {onUngroup ? (
        <ToolButton label="Ungroup" shortcut="Ctrl+Shift+G" onClick={onUngroup}>
          <Ungroup size={16} aria-hidden />
        </ToolButton>
      ) : null}
      <ToolButton label="Bring to front" onClick={onFront}>
        <BringToFront size={16} aria-hidden />
      </ToolButton>
      <ToolButton label="Send to back" onClick={onBack}>
        <SendToBack size={16} aria-hidden />
      </ToolButton>
      <ToolButton label="Duplicate" shortcut="Ctrl+D" onClick={onDuplicate}>
        <Copy size={16} aria-hidden />
      </ToolButton>
      <ToolButton label="Delete" shortcut="Backspace" onClick={onDelete}>
        <Trash2 size={16} aria-hidden />
      </ToolButton>
    </div>
  );
}
