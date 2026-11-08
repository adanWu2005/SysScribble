import type { RoomWithRole } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatRelativeTime,
  selectRooms,
  tabCounts,
  usagePercent,
  type DashboardQuery,
} from '@/lib/dashboard/filter';
import { DEFAULT_DASHBOARD_PREFS, parseDashboardPrefs, serializeDashboardPrefs } from '@/lib/dashboard/prefs';
import { MAX_STARS, parseStars, serializeStars, toggleStar } from '@/lib/dashboard/stars';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function room(n: number, over: Partial<RoomWithRole> = {}): RoomWithRole {
  return {
    id: id(n),
    ownerId: id(900),
    title: `Room ${n}`,
    version: 1,
    createdAt: new Date(2026, 0, n).toISOString(),
    updatedAt: new Date(2026, 1, n).toISOString(),
    role: 'OWNER',
    ...over,
  };
}

const rooms = [
  room(1, { title: 'Alpha plan', role: 'OWNER' }),
  room(2, { title: 'beta notes', role: 'EDITOR' }),
  room(3, { title: 'Gamma ray', role: 'VIEWER' }),
  room(4, { title: 'Émile Zola', role: 'OWNER' }),
];
const q = (over: Partial<DashboardQuery> = {}): DashboardQuery => ({ tab: 'all', search: '', sort: 'updated', ...over });
const ids = (list: RoomWithRole[]) => list.map((r) => r.title);
const none = new Set<string>();

describe('dashboard tabs', () => {
  it('splits owned from shared by role', () => {
    expect(ids(selectRooms(rooms, q({ tab: 'owned' }), none)).sort()).toEqual(['Alpha plan', 'Émile Zola']);
    expect(ids(selectRooms(rooms, q({ tab: 'shared' }), none)).sort()).toEqual(['Gamma ray', 'beta notes']);
  });

  it('never lists a room in both owned and shared', () => {
    const owned = selectRooms(rooms, q({ tab: 'owned' }), none);
    const shared = selectRooms(rooms, q({ tab: 'shared' }), none);
    expect(owned.length + shared.length).toBe(rooms.length);
  });

  it('lists favorites, and ignores a star for a room that is gone', () => {
    const starred = new Set([id(2), id(77)]);
    expect(ids(selectRooms(rooms, q({ tab: 'starred' }), starred))).toEqual(['beta notes']);
  });

  it('counts every tab', () => {
    expect(tabCounts(rooms, new Set([id(1)]))).toEqual({ all: 4, owned: 2, shared: 2, starred: 1 });
    expect(tabCounts([], none)).toEqual({ all: 0, owned: 0, shared: 0, starred: 0 });
  });
});

describe('dashboard search', () => {
  it('matches every word, ignoring case and accents', () => {
    expect(ids(selectRooms(rooms, q({ search: 'ALPHA' }), none))).toEqual(['Alpha plan']);
    expect(ids(selectRooms(rooms, q({ search: 'emile' }), none))).toEqual(['Émile Zola']);
    expect(ids(selectRooms(rooms, q({ search: 'plan alpha' }), none))).toEqual(['Alpha plan']);
    expect(selectRooms(rooms, q({ search: 'alpha zebra' }), none)).toEqual([]);
  });

  it('treats a blank search as no filter, and markup as plain text', () => {
    expect(selectRooms(rooms, q({ search: '   ' }), none)).toHaveLength(4);
    expect(selectRooms(rooms, q({ search: '<img onerror=x>' }), none)).toEqual([]);
  });

  it('combines the tab and the search', () => {
    expect(ids(selectRooms(rooms, q({ tab: 'shared', search: 'beta' }), none))).toEqual(['beta notes']);
    expect(selectRooms(rooms, q({ tab: 'owned', search: 'beta' }), none)).toEqual([]);
  });
});

describe('dashboard sort', () => {
  it('sorts by last updated, newest first', () => {
    expect(ids(selectRooms(rooms, q({ sort: 'updated' }), none))[0]).toBe('Émile Zola');
  });

  it('sorts by date created, newest first', () => {
    const swapped = [room(1, { createdAt: '2026-12-01T00:00:00Z' }), room(2), room(3)];
    expect(selectRooms(swapped, q({ sort: 'created' }), none)[0]?.id).toBe(id(1));
  });

  it('sorts alphabetically without regard to case or accents', () => {
    expect(ids(selectRooms(rooms, q({ sort: 'title' }), none))).toEqual(['Alpha plan', 'beta notes', 'Émile Zola', 'Gamma ray']);
  });

  it('sorts numbers in names by value', () => {
    const numbered = [room(1, { title: 'Sprint 10' }), room(2, { title: 'Sprint 2' })];
    expect(ids(selectRooms(numbered, q({ sort: 'title' }), none))).toEqual(['Sprint 2', 'Sprint 10']);
  });

  it('does not reorder or mutate the list it was given', () => {
    const copy = [...rooms];
    selectRooms(rooms, q({ sort: 'title' }), none);
    expect(rooms).toEqual(copy);
  });

  it('copes with a malformed timestamp', () => {
    const odd = [room(1, { updatedAt: 'not a date' }), room(2)];
    expect(() => selectRooms(odd, q(), none)).not.toThrow();
  });
});

describe('stars in storage', () => {
  it('reads a stored list back', () => {
    expect(parseStars(serializeStars([id(1), id(2)]))).toEqual([id(1), id(2)]);
  });

  it('drops anything that is not a room id, and survives garbage', () => {
    expect(parseStars(JSON.stringify([id(1), 'x', 5, null, '<script>', id(1)]))).toEqual([id(1)]);
    for (const bad of [null, '', 'not json', '{"a":1}', '5', 'null']) expect(parseStars(bad)).toEqual([]);
  });

  it('caps how many it keeps', () => {
    const many = Array.from({ length: MAX_STARS + 50 }, (_, n) => id(n));
    expect(parseStars(JSON.stringify(many))).toHaveLength(MAX_STARS);
    expect(JSON.parse(serializeStars(many))).toHaveLength(MAX_STARS);
  });

  it('toggles on and off without touching the original', () => {
    const start = [id(1)];
    expect(toggleStar(start, id(2))).toEqual([id(1), id(2)]);
    expect(toggleStar(start, id(1))).toEqual([]);
    expect(start).toEqual([id(1)]);
  });
});

describe('dashboard preferences', () => {
  it('round-trips and falls back on anything unexpected', () => {
    const prefs = { sort: 'title', view: 'table' } as const;
    expect(parseDashboardPrefs(serializeDashboardPrefs(prefs))).toEqual(prefs);
    for (const bad of [null, '', 'oops', '[]', '5', '{"sort":"evil","view":7}']) {
      expect(parseDashboardPrefs(bad)).toEqual(DEFAULT_DASHBOARD_PREFS);
    }
  });
});

describe('formatting', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads time in human units', () => {
    expect(formatRelativeTime(ago(3000), now)).toBe('just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe('2 days ago');
    expect(formatRelativeTime(ago(400 * 86_400_000), now)).toBe('last year');
  });

  it('treats the future and bad input safely', () => {
    expect(formatRelativeTime(new Date(now + 60_000).toISOString(), now)).toBe('just now');
    expect(formatRelativeTime('nonsense', now)).toBe('');
  });

  it('formats sizes and usage', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(usagePercent(50, 100)).toBe(50);
    expect(usagePercent(500, 100)).toBe(100);
    expect(usagePercent(-1, 100)).toBe(0);
    expect(usagePercent(10, 0)).toBe(0);
  });
});
