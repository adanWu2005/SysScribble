import type { Box, Point } from './geometry';

/** Camera maths for the infinite canvas. The view is the Konva stage transform. */

export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
export const INITIAL_VIEW: View = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function screenToWorld(view: View, screen: Point): Point {
  return { x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale };
}

export function worldToScreen(view: View, world: Point): Point {
  return { x: world.x * view.scale + view.x, y: world.y * view.scale + view.y };
}

/** Zooms so the world point under `anchor` (a screen point) stays under it. */
export function zoomAt(view: View, anchor: Point, nextScale: number): View {
  const scale = clampScale(nextScale);
  const world = screenToWorld(view, anchor);
  return { scale, x: anchor.x - world.x * scale, y: anchor.y - world.y * scale };
}

/** The world rectangle currently visible. */
export function viewportBounds(view: View, size: Size): Box {
  const topLeft = screenToWorld(view, { x: 0, y: 0 });
  return { x: topLeft.x, y: topLeft.y, width: size.width / view.scale, height: size.height / view.scale };
}

/** A view that shows `bounds` with a margin. An empty board resets to the origin. */
export function fitView(bounds: Box | null, size: Size, padding = 80): View {
  if (!bounds || size.width <= 0 || size.height <= 0) return INITIAL_VIEW;
  const availableW = Math.max(1, size.width - padding * 2);
  const availableH = Math.max(1, size.height - padding * 2);
  const raw = Math.min(availableW / Math.max(1, bounds.width), availableH / Math.max(1, bounds.height));
  // A single small shape should not fill the screen.
  const scale = clampScale(Math.min(raw, 2));
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return { scale, x: size.width / 2 - centerX * scale, y: size.height / 2 - centerY * scale };
}

/** A view with `world` at the middle of the screen, keeping the current zoom. */
export function centerOn(view: View, size: Size, world: Point, scale = view.scale): View {
  const next = clampScale(scale);
  return { scale: next, x: size.width / 2 - world.x * next, y: size.height / 2 - world.y * next };
}

/**
 * Dot spacing in world units. It doubles as you zoom out so the dots never get denser
 * than about 12 screen pixels apart.
 */
export function gridGap(scale: number): number {
  let gap = 24;
  while (gap * scale < 12) gap *= 2;
  return gap;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function lerpView(from: View, to: View, t: number): View {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    scale: from.scale + (to.scale - from.scale) * t,
  };
}
