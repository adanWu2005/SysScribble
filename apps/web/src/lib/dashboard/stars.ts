import { uuidSchema } from '@wb/shared';

/** Starred workspaces are remembered in this browser. The stored text is untrusted, so it is checked. */

export const STARS_KEY = 'wb:starred';
export const MAX_STARS = 500;

/** The starred room ids in `raw`. Anything malformed is dropped, never thrown. */
export function parseStars(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids = value.filter((entry): entry is string => typeof entry === 'string' && uuidSchema.safeParse(entry).success);
    return Array.from(new Set(ids)).slice(0, MAX_STARS);
  } catch {
    return [];
  }
}

export function serializeStars(ids: readonly string[]): string {
  return JSON.stringify(Array.from(new Set(ids)).slice(0, MAX_STARS));
}

/** Adds the id if it is missing, removes it if present. */
export function toggleStar(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id].slice(-MAX_STARS);
}
