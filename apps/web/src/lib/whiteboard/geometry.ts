import type { Shape } from '@wb/shared';

/** Pure geometry for the board. No React, no Konva, so all of it is unit-testable. */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ArrowShape = Extract<Shape, { type: 'arrow' }>;

const TEXT_LINE_HEIGHT = 1.2;
const TEXT_CHAR_WIDTH = 0.6;
const MIN_TEXT_WIDTH = 20;

function pointsBox(points: readonly number[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i] ?? 0;
    const py = points[i + 1] ?? 0;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The shape's box in its own coordinate system, before position and rotation. */
export function localBox(shape: Shape): Box {
  switch (shape.type) {
    case 'ellipse':
      return { x: -shape.width / 2, y: -shape.height / 2, width: shape.width, height: shape.height };
    case 'path':
    case 'arrow':
      return pointsBox(shape.points);
    case 'text': {
      // An estimate: the real size comes from the font, which only the renderer knows.
      const lines = shape.text.split('\n');
      const longest = Math.max(1, ...lines.map((line) => line.length));
      return {
        x: 0,
        y: 0,
        width: shape.width ?? Math.max(MIN_TEXT_WIDTH, longest * shape.fontSize * TEXT_CHAR_WIDTH),
        height: lines.length * shape.fontSize * TEXT_LINE_HEIGHT,
      };
    }
    default:
      return { x: 0, y: 0, width: shape.width, height: shape.height };
  }
}

function rotate(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export function toWorld(shape: Shape, local: Point): Point {
  const turned = rotate(local, shape.rotation);
  return { x: shape.x + turned.x, y: shape.y + turned.y };
}

export function toLocal(shape: Shape, world: Point): Point {
  return rotate({ x: world.x - shape.x, y: world.y - shape.y }, -shape.rotation);
}

/** Axis-aligned bounds in world space, which account for rotation. */
export function shapeBounds(shape: Shape): Box {
  const box = localBox(shape);
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((corner) => toWorld(shape, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function unionBounds(boxes: readonly Box[]): Box | null {
  const first = boxes[0];
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function normalizeBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function shapeCenter(shape: Shape): Point {
  const box = localBox(shape);
  return toWorld(shape, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Connectors attach to anything with an area. Strokes and other connectors have no inside. */
export function isConnectable(shape: Shape): boolean {
  return shape.type !== 'path' && shape.type !== 'arrow';
}

export function containsPoint(shape: Shape, world: Point): boolean {
  const local = toLocal(shape, world);
  const box = localBox(shape);
  if (shape.type === 'ellipse') {
    const rx = box.width / 2;
    const ry = box.height / 2;
    return (local.x / rx) ** 2 + (local.y / ry) ** 2 <= 1;
  }
  return local.x >= box.x && local.x <= box.x + box.width && local.y >= box.y && local.y <= box.y + box.height;
}

/** The topmost connectable shape under a point. `shapes` is back to front. */
export function hitConnectable(shapes: readonly Shape[], world: Point, excludeId?: string): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape && shape.id !== excludeId && isConnectable(shape) && containsPoint(shape, world)) return shape;
  }
  return null;
}

/** Where a line from the shape's center toward `toward` leaves the shape. */
export function boundaryPoint(shape: Shape, toward: Point): Point {
  const box = localBox(shape);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const target = toLocal(shape, toward);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return toWorld(shape, center);

  const halfW = box.width / 2;
  const halfH = box.height / 2;
  let t: number;
  if (shape.type === 'ellipse') {
    t = 1 / Math.sqrt((dx / halfW) ** 2 + (dy / halfH) ** 2);
  } else {
    const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
    const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return toWorld(shape, { x: center.x + dx * t, y: center.y + dy * t });
}

/**
 * World positions of both ends. An attached end sits on the boundary of its shape, facing the
 * other end. An end whose shape no longer exists falls back to its free point.
 */
export function arrowEndpoints(arrow: ArrowShape, byId: ReadonlyMap<string, Shape>): { start: Point; end: Point } {
  const startShape = arrow.startShapeId !== undefined ? byId.get(arrow.startShapeId) : undefined;
  const endShape = arrow.endShapeId !== undefined ? byId.get(arrow.endShapeId) : undefined;
  const freeStart = { x: arrow.x + arrow.points[0], y: arrow.y + arrow.points[1] };
  const freeEnd = { x: arrow.x + arrow.points[2], y: arrow.y + arrow.points[3] };

  const startRef = startShape && isConnectable(startShape) ? shapeCenter(startShape) : freeStart;
  const endRef = endShape && isConnectable(endShape) ? shapeCenter(endShape) : freeEnd;
  return {
    start: startShape && isConnectable(startShape) ? boundaryPoint(startShape, endRef) : freeStart,
    end: endShape && isConnectable(endShape) ? boundaryPoint(endShape, startRef) : freeEnd,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
