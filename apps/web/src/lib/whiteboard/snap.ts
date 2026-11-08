import type { Box } from './geometry';

/**
 * Smart guides: while a shape is dragged, its edges and middle line snap to the edges and middle
 * lines of the other shapes, and a guide line shows what it lined up with. Pure, so it is testable.
 */

export interface Guide {
  axis: 'x' | 'y';
  /** The coordinate of the line: an x for a vertical guide, a y for a horizontal one. */
  at: number;
  /** The extent along the other axis. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** Add these to the dragged box to land it on the guides. */
  dx: number;
  dy: number;
  guides: Guide[];
}

/** Closer than this, in screen pixels, and an edge snaps. */
export const SNAP_THRESHOLD_PX = 6;

const SAME = 0.5;

function anchorsX(box: Box): number[] {
  return [box.x, box.x + box.width / 2, box.x + box.width];
}

function anchorsY(box: Box): number[] {
  return [box.y, box.y + box.height / 2, box.y + box.height];
}

/** The smallest signed move that lines one of `mine` up with one of `targets`, within `threshold`. */
function bestOffset(mine: readonly number[], targets: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  for (const a of mine) {
    for (const b of targets) {
      const offset = b - a;
      if (Math.abs(offset) <= threshold && (best === null || Math.abs(offset) < Math.abs(best))) best = offset;
    }
  }
  return best;
}

/**
 * Finds the snap for `moving` against `others`. `threshold` is in world units, so the caller
 * divides the pixel threshold by the zoom. A guide spans the dragged box and every shape it lines up with.
 */
export function computeSnap(moving: Box, others: readonly Box[], threshold: number): SnapResult {
  if (others.length === 0 || !(threshold > 0)) return { dx: 0, dy: 0, guides: [] };

  const targetsX = others.flatMap(anchorsX);
  const targetsY = others.flatMap(anchorsY);
  const dx = bestOffset(anchorsX(moving), targetsX, threshold);
  const dy = bestOffset(anchorsY(moving), targetsY, threshold);

  const snapped: Box = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) };
  const guides: Guide[] = [];

  if (dx !== null) {
    for (const at of anchorsX(snapped)) {
      const matches = others.filter((box) => anchorsX(box).some((anchor) => Math.abs(anchor - at) < SAME));
      if (matches.length === 0) continue;
      const boxes = [snapped, ...matches];
      guides.push({
        axis: 'x',
        at,
        from: Math.min(...boxes.map((box) => box.y)),
        to: Math.max(...boxes.map((box) => box.y + box.height)),
      });
    }
  }
  if (dy !== null) {
    for (const at of anchorsY(snapped)) {
      const matches = others.filter((box) => anchorsY(box).some((anchor) => Math.abs(anchor - at) < SAME));
      if (matches.length === 0) continue;
      const boxes = [snapped, ...matches];
      guides.push({
        axis: 'y',
        at,
        from: Math.min(...boxes.map((box) => box.x)),
        to: Math.max(...boxes.map((box) => box.x + box.width)),
      });
    }
  }
  return { dx: dx ?? 0, dy: dy ?? 0, guides };
}
