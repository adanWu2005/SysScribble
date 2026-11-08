import type { Point } from '@/lib/whiteboard/geometry';

/** What a ghost collaborator does and how it moves. Pure and seedable, so it can be tested. */

export type Random = () => number;

export const MAX_GHOSTS = 3;
/** A ghost adds at most this many sticky notes and this many characters of text, then goes quiet. */
export const MAX_GHOST_STICKIES = 8;
export const MAX_GHOST_CHARS = 600;

export const GHOST_COLORS = ['#7c3aed', '#0891b2', '#d97706'] as const;
export const STICKY_COLORS = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#c4b5fd'] as const;

export const STICKY_TEXTS = [
  'Ship it',
  'What about retries?',
  'Needs a load test',
  'Cache this',
  'Who owns this?',
  'Idea: batch the writes',
  'Blocked on review',
  'Looks good to me',
] as const;

export const NOTE_PHRASES = [
  'Two writers, one document, and nothing is lost. ',
  'The CRDT merges edits from every replica in any order. ',
  'Typing here arrives through a real socket, not a shortcut. ',
  'Try going offline and edit the same line. ',
] as const;

export function ghostName(index: number): string {
  return `Ghost ${index}`;
}

export function ghostColor(index: number): string {
  return GHOST_COLORS[(index - 1) % GHOST_COLORS.length] ?? GHOST_COLORS[0];
}

/**
 * A figure-eight around `center`. `phase` offsets each ghost so several do not trace the same
 * path. `radius` is the half-width. The height is half of that, which makes the loop read as an eight.
 */
export function figureEight(seconds: number, center: Point, radius: number, phase = 0): Point {
  const angle = seconds * 1.1 + phase;
  return { x: center.x + radius * Math.sin(angle), y: center.y + (radius / 2) * Math.sin(2 * angle) };
}

export function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

export function pick<T>(random: Random, list: readonly T[]): T {
  const item = list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  if (item === undefined) throw new Error('pick() needs a non-empty list');
  return item;
}

/** Smooth start and finish, so a sticky note glides instead of snapping. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}

export function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * The first free ghost number from 1 to MAX_GHOSTS, or null when all are taken. Reusing the lowest
 * free number keeps the names tidy as ghosts come and go.
 */
export function freeGhostIndex(taken: Iterable<number>): number | null {
  const used = new Set(taken);
  for (let index = 1; index <= MAX_GHOSTS; index++) if (!used.has(index)) return index;
  return null;
}
