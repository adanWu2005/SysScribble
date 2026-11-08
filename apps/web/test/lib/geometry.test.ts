import type { Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import {
  arrowEndpoints,
  boundaryPoint,
  boxesIntersect,
  containsPoint,
  hitConnectable,
  normalizeBox,
  shapeBounds,
  shapeCenter,
  unionBounds,
} from '@/lib/whiteboard/geometry';

type Arrow = Extract<Shape, { type: 'arrow' }>;

function rect(id: string, x: number, y: number, width = 100, height = 50, rotation = 0): Shape {
  return { id, type: 'rect', x, y, rotation, width, height, fill: '#ffffff' };
}

function ellipse(id: string, x: number, y: number, width = 100, height = 60): Shape {
  return { id, type: 'ellipse', x, y, rotation: 0, width, height, fill: '#ffffff' };
}

function arrow(partial: Partial<Arrow> = {}): Arrow {
  return {
    id: 'arrow',
    type: 'arrow',
    x: 0,
    y: 0,
    rotation: 0,
    points: [0, 0, 10, 10],
    stroke: '#111827',
    strokeWidth: 3,
    ...partial,
  };
}

const map = (...shapes: Shape[]) => new Map(shapes.map((shape) => [shape.id, shape]));

describe('shape bounds', () => {
  it('uses the top-left origin for rectangles and the center for ellipses', () => {
    expect(shapeBounds(rect('r', 10, 20))).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(shapeBounds(ellipse('e', 100, 100))).toEqual({ x: 50, y: 70, width: 100, height: 60 });
  });

  it('grows the bounds of a rotated shape', () => {
    const box = shapeBounds(rect('r', 0, 0, 100, 50, 90));
    // Turned a quarter around its top-left corner: it now spans x from -50 to 0 and y from 0 to 100.
    expect(box.x).toBeCloseTo(-50);
    expect(box.y).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(50);
    expect(box.height).toBeCloseTo(100);
  });

  it('bounds a pen stroke by its points', () => {
    const path: Shape = { id: 'p', type: 'path', x: 5, y: 5, rotation: 0, points: [0, 0, 20, -10, 30, 40], stroke: '#111827', strokeWidth: 3 };
    expect(shapeBounds(path)).toEqual({ x: 5, y: -5, width: 30, height: 50 });
  });

  it('unions boxes and reports nothing for an empty list', () => {
    expect(unionBounds([])).toBeNull();
    expect(unionBounds([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 }])).toEqual({
      x: 0,
      y: -5,
      width: 25,
      height: 15,
    });
  });

  it('tests box overlap, including touching edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(boxesIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(boxesIntersect(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(true);
    expect(boxesIntersect(a, { x: 11, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it('normalizes a box dragged up and to the left', () => {
    expect(normalizeBox({ x: 10, y: 10 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 2, width: 6, height: 8 });
  });
});

describe('hit testing', () => {
  it('treats the corner of an ellipse bounding box as outside', () => {
    const e = ellipse('e', 100, 100);
    expect(containsPoint(e, { x: 100, y: 100 })).toBe(true);
    expect(containsPoint(e, { x: 148, y: 128 })).toBe(false);
  });

  it('follows rotation', () => {
    const r = rect('r', 0, 0, 100, 10, 90);
    // Rotated a quarter turn, the long side now runs downward from the origin.
    expect(containsPoint(r, { x: -5, y: 80 })).toBe(true);
    expect(containsPoint(r, { x: 80, y: 5 })).toBe(false);
  });

  it('picks the topmost connectable shape and ignores strokes', () => {
    const below = rect('below', 0, 0);
    const above = rect('above', 0, 0);
    const path: Shape = { id: 'p', type: 'path', x: 0, y: 0, rotation: 0, points: [0, 0, 50, 0], stroke: '#111827', strokeWidth: 3 };
    expect(hitConnectable([below, above, path], { x: 10, y: 10 })?.id).toBe('above');
    expect(hitConnectable([below, above], { x: 10, y: 10 }, 'above')?.id).toBe('below');
    expect(hitConnectable([path], { x: 10, y: 0 })).toBeNull();
  });
});

describe('connectors', () => {
  it('leaves a rectangle through the side facing the other end', () => {
    const r = rect('r', 0, 0, 100, 50);
    const point = boundaryPoint(r, { x: 500, y: 25 });
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(25);
  });

  it('leaves an ellipse on its curve', () => {
    const e = ellipse('e', 0, 0, 100, 60);
    const point = boundaryPoint(e, { x: 500, y: 0 });
    expect(point.x).toBeCloseTo(50);
    expect(point.y).toBeCloseTo(0);
  });

  it('uses the free points when nothing is attached', () => {
    const { start, end } = arrowEndpoints(arrow({ x: 5, y: 5, points: [0, 0, 20, 10] }), map());
    expect(start).toEqual({ x: 5, y: 5 });
    expect(end).toEqual({ x: 25, y: 15 });
  });

  it('joins two shapes boundary to boundary', () => {
    const a = rect('a', 0, 0, 100, 50);
    const b = rect('b', 300, 0, 100, 50);
    const { start, end } = arrowEndpoints(arrow({ startShapeId: 'a', endShapeId: 'b' }), map(a, b));
    expect(start.x).toBeCloseTo(100);
    expect(end.x).toBeCloseTo(300);
    expect(start.y).toBeCloseTo(25);
    expect(end.y).toBeCloseTo(25);
  });

  it('follows a shape when it moves', () => {
    const arrowShape = arrow({ startShapeId: 'a', endShapeId: 'b' });
    const before = arrowEndpoints(arrowShape, map(rect('a', 0, 0), rect('b', 300, 0)));
    const after = arrowEndpoints(arrowShape, map(rect('a', 0, 0), rect('b', 300, 200)));
    expect(after.end.y).toBeGreaterThan(before.end.y);
  });

  it('falls back to the free point when the attached shape is gone', () => {
    const { end } = arrowEndpoints(arrow({ points: [0, 0, 40, 40], endShapeId: 'missing' }), map());
    expect(end).toEqual({ x: 40, y: 40 });
  });

  it('computes a shape center in world space', () => {
    expect(shapeCenter(rect('r', 10, 10, 100, 50))).toEqual({ x: 60, y: 35 });
  });
});
