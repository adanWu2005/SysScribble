'use client';

import {
  ArrowUpRight,
  Circle,
  MessageSquare,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Tool } from '@/lib/whiteboard/shortcuts';

export type { Tool };

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  /** Set for toggle-style buttons. Leave out for plain actions. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** An icon button with a tooltip. The label is also the accessible name. */
export function ToolButton({ label, shortcut, pressed, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={(event) => {
        // A mouse click should not leave focus here, or the space bar would press the button
        // instead of panning. Keyboard activation (detail 0) keeps its focus ring.
        if (event.detail > 0) event.currentTarget.blur();
        onClick();
      }}
      className={`group relative flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-35 ${
        pressed
          ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'text-neutral-700 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700'
      }`}
    >
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded bg-neutral-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity delay-300 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {label}
        {shortcut ? (
          <kbd className="rounded bg-white/20 px-1 font-mono text-[10px] dark:bg-black/10">{shortcut}</kbd>
        ) : null}
      </span>
    </button>
  );
}

const TOOLS: readonly { id: Tool; label: string; shortcut: string; Icon: LucideIcon }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', Icon: Circle },
  { id: 'sticky', label: 'Sticky note', shortcut: 'S', Icon: StickyNote },
  { id: 'pen', label: 'Pen', shortcut: 'P', Icon: Pencil },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', Icon: ArrowUpRight },
  { id: 'text', label: 'Text', shortcut: 'T', Icon: Type },
  { id: 'comment', label: 'Comment', shortcut: 'C', Icon: MessageSquare },
  { id: 'laser', label: 'Laser pointer', shortcut: 'L', Icon: Zap },
];

interface ToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onDelete: () => void;
  canDelete: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  children?: ReactNode;
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-neutral-300 dark:bg-neutral-600" />;
}

export function Toolbar({
  tool,
  onToolChange,
  onDelete,
  canDelete,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  children,
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-2xl border border-neutral-200 bg-white/95 p-1 shadow-md backdrop-blur dark:border-neutral-700 dark:bg-neutral-800/95"
    >
      {TOOLS.map(({ id, label, shortcut, Icon }) => (
        <ToolButton key={id} label={label} shortcut={shortcut} pressed={tool === id} onClick={() => onToolChange(id)}>
          <Icon size={17} aria-hidden />
        </ToolButton>
      ))}
      <Divider />
      <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={17} aria-hidden />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={17} aria-hidden />
      </ToolButton>
      <Divider />
      <ToolButton label="Delete" shortcut="Backspace" disabled={!canDelete} onClick={onDelete}>
        <Trash2 size={17} aria-hidden />
      </ToolButton>
      {children}
    </div>
  );
}
