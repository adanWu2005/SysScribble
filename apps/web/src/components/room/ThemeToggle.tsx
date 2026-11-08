'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { nextThemePref, type ThemePref } from '@/lib/theme/theme';

const ICONS: Readonly<Record<ThemePref, LucideIcon>> = { system: Monitor, light: Sun, dark: Moon };
const NAMES: Readonly<Record<ThemePref, string>> = { system: 'Match system', light: 'Light', dark: 'Dark' };

interface ThemeToggleProps {
  pref: ThemePref;
  onChange: (pref: ThemePref) => void;
}

/** Cycles match-system, light and dark. The choice is remembered in this browser. */
export function ThemeToggle({ pref, onChange }: ThemeToggleProps) {
  const Icon = ICONS[pref];
  const next = nextThemePref(pref);
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={`Theme: ${NAMES[pref]}. Click for ${NAMES[next]}.`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      <Icon size={15} aria-hidden />
      <span className="sr-only">{`Theme: ${NAMES[pref]}. Switch to ${NAMES[next]}.`}</span>
    </button>
  );
}
