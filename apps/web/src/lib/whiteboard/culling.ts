import type { Shape } from '@wb/shared';
import { arrowEndpoints, boxesIntersect, shapeBounds, type Box } from './geometry';
import type { Size, View } from './viewport';

/**
 * Viewport culling: only shapes near the screen are given to the renderer. Pure, so it is testable.
 * Culling changes what is drawn, never what exists: hit-testing, export and the minimap still use
 * the full list.
 */

/** Screen pixels of slack on every side, so a shape is mounted before it scrolls into view. */
export const CULL_MARGIN_PX = 240;
/**
 * World units added around every shape. The sizes of text and strokes are estimates, and shadows
 * and selection handles draw outside the box, so a shape is kept a little beyond its edge.
 */
const SHAPE_PAD = 32;

/** The part of the world the screen shows, widened by `marginPx`. */
export function visibleWorldBox(view: View, size: Size, marginPx: number = CULL_MARGIN_PX): Box {
  const margin = marginPx / view.scale;
  return {
    x: -view.x / view.scale - margin,
    y: -view.y / view.scale - margin,
    width: size.width / view.scale + margin * 2,
    height: size.height / view.scale + margin * 2,
  };
}

/** Where a shape draws. A connector draws between the shapes it is attached to, not at its stored points. */
export function cullBox(shape: Shape, byId: ReadonlyMap<string, Shape>): Box {
  if (shape.type === 'arrow') {
    const { start, end } = arrowEndpoints(shape, byId);
    const pad = SHAPE_PAD + shape.strokeWidth;
    return {
      x: Math.min(start.x, end.x) - pad,
      y: Math.min(start.y, end.y) - pad,
      width: Math.abs(start.x - end.x) + pad * 2,
      height: Math.abs(start.y - end.y) + pad * 2,
    };
  }
  const box = shapeBounds(shape);
  const pad = SHAPE_PAD + (shape.type === 'path' ? shape.strokeWidth : 0);
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

/**
 * The shapes to render, in their original order. Anything in `keep` is always included: the
 * selection (its handles are attached by id), the shape being edited, the target of a pulse.
 * Before the canvas has a size nothing can be judged, so everything is kept.
 */
export function cullShapes(
  shapes: readonly Shape[],
  byId: ReadonlyMap<string, Shape>,
  view: View,
  size: Size,
  keep: ReadonlySet<string>,
): Shape[] {
  if (size.width <= 0 || size.height <= 0 || !(view.scale > 0)) return [...shapes];
  const area = visibleWorldBox(view, size);
  return shapes.filter((shape) => keep.has(shape.id) || boxesIntersect(area, cullBox(shape, byId)));
}
