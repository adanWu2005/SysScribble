import type { Point } from './geometry';
import { centerOn, screenToWorld, type Size, type View } from './viewport';

/** Pure logic behind presence: who is here, where they look, and how a laser fades. */

export interface PresencePeer {
  clientId: number;
  user: { id: string; name: string; color: string };
  viewport?: { cx: number; cy: number; scale: number } | null | undefined;
  /** A Chaos Lab ghost: another socket of a real user, listed as its own participant. */
  ghost?: boolean | undefined;
}

export interface PeerGroup<P extends PresencePeer = PresencePeer> {
  userId: string;
  name: string;
  color: string;
  ghost: boolean;
  peers: P[];
}

/**
 * One entry per person, even when they have the room open in several tabs. A ghost shares its
 * user's id, so it is keyed by its own client instead, or it would vanish into its user's avatar.
 */
export function groupPeers<P extends PresencePeer>(peers: readonly P[]): PeerGroup<P>[] {
  const groups = new Map<string, PeerGroup<P>>();
  for (const peer of peers) {
    const key = peer.ghost ? `ghost:${peer.clientId}` : peer.user.id;
    const existing = groups.get(key);
    if (existing) existing.peers.push(peer);
    else {
      groups.set(key, {
        userId: key,
        name: peer.user.name,
        color: peer.user.color,
        ghost: peer.ghost === true,
        peers: [peer],
      });
    }
  }
  return Array.from(groups.values());
}

/**
 * The tab of `userId` that is publishing a viewport, preferring the most recently joined. A ghost
 * shares its user's id but has no view of its own, so it is never the one followed.
 */
export function followTarget<P extends PresencePeer>(peers: readonly P[], userId: string): P | undefined {
  for (let i = peers.length - 1; i >= 0; i--) {
    const peer = peers[i];
    if (peer && peer.ghost !== true && peer.user.id === userId && peer.viewport) return peer;
  }
  return undefined;
}

export interface SharedViewport {
  cx: number;
  cy: number;
  scale: number;
}

/** What to publish: the world point at the middle of the screen, plus the zoom. */
export function viewToShared(view: View, size: Size): SharedViewport {
  const center = screenToWorld(view, { x: size.width / 2, y: size.height / 2 });
  return { cx: center.x, cy: center.y, scale: view.scale };
}

/** The view that puts a followed user's center in the middle of our own screen. */
export function sharedToView(shared: SharedViewport, size: Size): View {
  return centerOn({ x: 0, y: 0, scale: shared.scale }, size, { x: shared.cx, y: shared.cy }, shared.scale);
}

/**
 * Moves `current` toward `target` by an amount that depends on elapsed time, not frame rate,
 * so a cursor glides the same on a 60 Hz and a 144 Hz screen. It snaps when nearly there.
 */
export function smoothTo(current: Point, target: Point, elapsedMs: number, timeConstantMs = 45): Point {
  const k = 1 - Math.exp(-Math.max(0, elapsedMs) / timeConstantMs);
  const x = current.x + (target.x - current.x) * k;
  const y = current.y + (target.y - current.y) * k;
  if (Math.abs(target.x - x) < 0.05 && Math.abs(target.y - y) < 0.05) return { x: target.x, y: target.y };
  return { x, y };
}

export const LASER_LIFETIME_MS = 800;
export const MAX_TRAIL_POINTS = 48;

export interface TrailPoint extends Point {
  t: number;
}

export function pruneTrail(points: readonly TrailPoint[], now: number): TrailPoint[] {
  return points.filter((point) => now - point.t < LASER_LIFETIME_MS);
}

/** Adds the laser's newest position. A repeat of the last position adds nothing. */
export function appendTrail(points: readonly TrailPoint[], next: Point, now: number): TrailPoint[] {
  const last = points[points.length - 1];
  const fresh = pruneTrail(points, now);
  if (last && last.x === next.x && last.y === next.y) return fresh;
  return [...fresh, { x: next.x, y: next.y, t: now }].slice(-MAX_TRAIL_POINTS);
}

/** 1 for a point just made, fading to 0 at the end of its life. */
export function trailAlpha(point: TrailPoint, now: number): number {
  const life = 1 - (now - point.t) / LASER_LIFETIME_MS;
  return Math.max(0, Math.min(1, life)) ** 1.5;
}
