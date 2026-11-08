'use client';

import { Code, Heading1, Heading2, Heading3, Info, List, ListChecks, Minus, type LucideIcon } from 'lucide-react';
import type { SlashCommandId, SlashItem } from '@/lib/notes/slash';

const ICONS: Readonly<Record<SlashCommandId, LucideIcon>> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  task: ListChecks,
  code: Code,
  callout: Info,
  divider: Minus,
};

export interface SlashAnchor {
  left: number;
  /** Distance from the top of the container, or from its bottom when `flip` is set. */
  top: number;
  flip: boolean;
}

interface SlashMenuProps {
  items: readonly SlashItem[];
  index: number;
  anchor: SlashAnchor;
  onPick: (id: SlashCommandId) => void;
  onHover: (index: number) => void;
}

/** The `/` command list. The editor keeps focus: arrows, Enter and Escape are handled there. */
export function SlashMenu({ items, index, anchor, onPick, onHover }: SlashMenuProps) {
  return (
    <div
      role="listbox"
      aria-label="Insert a block"
      style={anchor.flip ? { left: anchor.left, bottom: anchor.top } : { left: anchor.left, top: anchor.top }}
      // Clicking an item must not move focus out of the editor.
      onMouseDown={(event) => event.preventDefault()}
      className="absolute z-30 max-h-72 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
    >
      {items.map((item, position) => {
        const Icon = ICONS[item.id];
        const active = position === index;
        return (
          <div
            key={item.id}
            id={`slash-${item.id}`}
            role="option"
            aria-selected={active}
            onMouseEnter={() => onHover(position)}
            onClick={() => onPick(item.id)}
            className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 ${
              active ? 'bg-neutral-100 dark:bg-neutral-700' : ''
            }`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
              <Icon size={16} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</span>
              <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{item.hint}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
