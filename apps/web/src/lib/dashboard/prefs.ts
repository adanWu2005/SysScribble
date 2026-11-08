import type { SortKey, ViewMode } from './filter';

/** How the dashboard looks, remembered per browser. The stored text is untrusted, so it is checked. */

export const DASHBOARD_PREFS_KEY = 'wb:dashboard';

export interface DashboardPrefs {
  sort: SortKey;
  view: ViewMode;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = { sort: 'updated', view: 'grid' };

export function parseDashboardPrefs(raw: string | null): DashboardPrefs {
  if (!raw) return DEFAULT_DASHBOARD_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_DASHBOARD_PREFS;
    const record = value as Record<string, unknown>;
    const sort: SortKey = record['sort'] === 'created' || record['sort'] === 'title' ? record['sort'] : 'updated';
    const view: ViewMode = record['view'] === 'table' ? 'table' : 'grid';
    return { sort, view };
  } catch {
    return DEFAULT_DASHBOARD_PREFS;
  }
}

export function serializeDashboardPrefs(prefs: DashboardPrefs): string {
  return JSON.stringify(prefs);
}
