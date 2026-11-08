import type { RoomWithRole } from '@wb/shared';

/** Which workspaces the dashboard lists, in what order. Pure, so it is testable. */

export type DashboardTab = 'all' | 'owned' | 'shared' | 'starred';
export type SortKey = 'updated' | 'created' | 'title';
export type ViewMode = 'grid' | 'table';

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  updated: 'Last updated',
  created: 'Date created',
  title: 'Alphabetical',
};

export const TAB_LABELS: Readonly<Record<DashboardTab, string>> = {
  all: 'All workspaces',
  owned: 'Owned by me',
  shared: 'Shared with me',
  starred: 'Favorites',
};

export const TABS: readonly DashboardTab[] = ['all', 'owned', 'shared', 'starred'];

function inTab(room: RoomWithRole, tab: DashboardTab, starred: ReadonlySet<string>): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'owned':
      return room.role === 'OWNER';
    case 'shared':
      return room.role === 'EDITOR' || room.role === 'VIEWER';
    case 'starred':
      return starred.has(room.id);
  }
}

/** How many workspaces each tab would show, for the sidebar badges. */
export function tabCounts(rooms: readonly RoomWithRole[], starred: ReadonlySet<string>): Record<DashboardTab, number> {
  const counts: Record<DashboardTab, number> = { all: 0, owned: 0, shared: 0, starred: 0 };
  for (const tab of TABS) counts[tab] = rooms.filter((room) => inTab(room, tab, starred)).length;
  return counts;
}

function norm(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function time(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function compare(sort: SortKey): (a: RoomWithRole, b: RoomWithRole) => number {
  switch (sort) {
    case 'updated':
      return (a, b) => time(b.updatedAt) - time(a.updatedAt) || a.title.localeCompare(b.title);
    case 'created':
      return (a, b) => time(b.createdAt) - time(a.createdAt) || a.title.localeCompare(b.title);
    case 'title':
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
  }
}

export interface DashboardQuery {
  tab: DashboardTab;
  search: string;
  sort: SortKey;
}

/** The rooms to show: filtered by tab, then by every word of the search, then sorted. */
export function selectRooms(
  rooms: readonly RoomWithRole[],
  query: DashboardQuery,
  starred: ReadonlySet<string>,
): RoomWithRole[] {
  const words = norm(query.search).split(/\s+/).filter(Boolean);
  return rooms
    .filter((room) => inTab(room, query.tab, starred))
    .filter((room) => {
      const title = norm(room.title);
      return words.every((word) => title.includes(word));
    })
    .sort(compare(query.sort));
}

const UNITS: readonly { limit: number; unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { limit: 60_000, unit: 'second', ms: 1000 },
  { limit: 3_600_000, unit: 'minute', ms: 60_000 },
  { limit: 86_400_000, unit: 'hour', ms: 3_600_000 },
  { limit: 2_592_000_000, unit: 'day', ms: 86_400_000 },
  { limit: 31_536_000_000, unit: 'month', ms: 2_592_000_000 },
];

/** "3 hours ago". A bad or future timestamp reads as "just now". */
export function formatRelativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const elapsed = now - then;
  if (elapsed < 10_000) return 'just now';
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const { limit, unit, ms } of UNITS) {
    if (elapsed < limit) return formatter.format(-Math.floor(elapsed / ms), unit);
  }
  return formatter.format(-Math.floor(elapsed / 31_536_000_000), 'year');
}

/** "12.4 MB". Sizes are bytes; anything not a number reads as zero. */
export function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Share of a budget used, kept between 0 and 100 for a progress bar. */
export function usagePercent(used: number, budget: number): number {
  if (!(budget > 0) || !Number.isFinite(used) || used <= 0) return 0;
  return Math.min(100, (used / budget) * 100);
}
