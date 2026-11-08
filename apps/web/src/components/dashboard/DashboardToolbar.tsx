'use client';

import { LayoutGrid, Menu, Rows3, Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import { SORT_LABELS, type SortKey, type ViewMode } from '@/lib/dashboard/filter';

interface DashboardToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  /** Opens the sidebar on small screens, where it is a slide-over. */
  onOpenNav: () => void;
}

const VIEWS: readonly { id: ViewMode; label: string; Icon: typeof LayoutGrid }[] = [
  { id: 'grid', label: 'Grid view', Icon: LayoutGrid },
  { id: 'table', label: 'Table view', Icon: Rows3 },
];

/** Search, sort and view switch. Ctrl or Cmd+K focuses the search from anywhere on the page. */
export function DashboardToolbar({ search, onSearch, searchRef, sort, onSort, view, onView, onOpenNav }: DashboardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 md:px-8">
      <button
        type="button"
        aria-label="Open navigation"
        onClick={onOpenNav}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 md:hidden dark:border-neutral-700"
      >
        <Menu size={16} aria-hidden />
      </button>

      <div className="relative min-w-[12rem] flex-1">
        <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          ref={searchRef}
          type="search"
          value={search}
          maxLength={120}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onSearch('');
              event.currentTarget.blur();
            }
          }}
          placeholder="Filter workspaces…"
          aria-label="Filter workspaces"
          className="h-9 w-full rounded-md border border-neutral-300 bg-transparent pl-9 pr-16 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 [&::-webkit-search-cancel-button]:hidden"
        />
        {search !== '' ? (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => {
              onSearch('');
              searchRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"
          >
            <X size={14} aria-hidden />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-neutral-300 px-1.5 font-sans text-[11px] text-neutral-500 sm:block dark:border-neutral-600">
            Ctrl K
          </kbd>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
        <span className="sr-only sm:not-sr-only">Sort</span>
        <select
          value={sort}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'updated' || next === 'created' || next === 'title') onSort(next);
          }}
          className="h-9 rounded-md border border-neutral-300 bg-transparent px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <div role="group" aria-label="View" className="inline-flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-700">
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={view === id}
            onClick={() => onView(id)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded ${
              view === id
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            <Icon size={15} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
