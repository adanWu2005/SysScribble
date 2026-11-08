'use client';

import { Columns2, FileText, PenTool, type LucideIcon } from 'lucide-react';
import type { ViewMode } from '@/lib/layout/prefs';

const MODES: readonly { mode: ViewMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'notes', label: 'Notes Only', Icon: FileText },
  { mode: 'split', label: 'Split View', Icon: Columns2 },
  { mode: 'canvas', label: 'Canvas Only', Icon: PenTool },
];

interface ViewModeSwitchProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/** A segmented control for which panes show. It is a layout choice, so every role can use it. */
export function ViewModeSwitch({ mode, onChange }: ViewModeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-800"
    >
      {MODES.map(({ mode: value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(value)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
              active
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
                : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
            }`}
          >
            <Icon size={14} aria-hidden />
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
