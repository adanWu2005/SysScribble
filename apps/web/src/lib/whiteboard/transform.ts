import type { Shape } from '@wb/shared';

/** What the renderer reports for a node after the user finished resizing or rotating it. */
export interface NodeTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export const MIN_SHAPE_SIZE = 10;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Converts a finished transform into document properties. The renderer's scale is baked into
 * the shape's own size, so the stored shape never carries a scale and the node resets to 1.
 * Connectors are not transformed: their ends follow the shapes they are attached to.
 */
export function transformPatch(shape: Shape, t: NodeTransform): Partial<Shape> | null {
  const scaleX = Math.abs(t.scaleX);
  const scaleY = Math.abs(t.scaleY);
  const base = { x: t.x, y: t.y, rotation: normalizeDegrees(t.rotation) };

  switch (shape.type) {
    case 'rect':
    case 'ellipse':
    case 'sticky':
    case 'image':
    case 'file':
      return {
        ...base,
        width: Math.max(MIN_SHAPE_SIZE, shape.width * scaleX),
        height: Math.max(MIN_SHAPE_SIZE, shape.height * scaleY),
      };
    case 'path':
      return { ...base, points: shape.points.map((value, index) => (index % 2 === 0 ? value * scaleX : value * scaleY)) };
    case 'text':
      return {
        ...base,
        fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, shape.fontSize * scaleY)),
        width: shape.width === undefined ? undefined : Math.max(MIN_SHAPE_SIZE, shape.width * scaleX),
      };
    case 'arrow':
      return null;
  }
}
