/**
 * Live headcount per room, for the dashboard's "N active now" pill. Each WebSocket instance writes
 * how many distinct people it has in a room into a small Redis hash, and the web app adds the
 * instances up. A field carries its own timestamp, so an instance that dies leaves a stale entry
 * that stops counting after `PRESENCE_STALE_MS` instead of showing someone who left.
 *
 * It is only a count. No user ids or names are stored.
 */

export function presenceKey(roomId: string): string {
  return `presence:room:${roomId}`;
}

/** How often an instance rewrites its count while people are connected. */
export const PRESENCE_REFRESH_MS = 20_000;
/** A count older than this is ignored, so a crashed instance stops counting within a minute. */
export const PRESENCE_STALE_MS = 50_000;
/** The hash expires on its own if nothing refreshes it. */
export const PRESENCE_KEY_TTL_SEC = 120;
/** A busy room cannot report more than this, so a bad value cannot print a silly number. */
const MAX_REPORTED = 10_000;

export function encodePresence(users: number, now: number): string {
  const count = Number.isFinite(users) ? Math.max(0, Math.min(MAX_REPORTED, Math.floor(users))) : 0;
  return `${count}:${Math.floor(now)}`;
}

/** The total across instances. The hash comes from Redis, so it is still checked, never trusted. */
export function sumPresence(fields: Readonly<Record<string, unknown>> | null | undefined, now: number): number {
  if (!fields) return 0;
  let total = 0;
  for (const value of Object.values(fields)) {
    if (typeof value !== 'string') continue;
    const match = /^(\d{1,5}):(\d{10,14})$/.exec(value);
    if (!match) continue;
    const count = Number(match[1]);
    const at = Number(match[2]);
    if (now - at > PRESENCE_STALE_MS || at - now > PRESENCE_STALE_MS) continue;
    total += Math.min(count, MAX_REPORTED);
  }
  return Math.min(total, MAX_REPORTED);
}
