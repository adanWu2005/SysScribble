import type { Shape } from '@wb/shared';
import type { Box, Point } from './geometry';
import { newShapeId } from './model';

/** Default look of newly created shapes. */

export const DEFAULT_STROKE = '#111827';
export const DEFAULT_STROKE_WIDTH = 3;

export type CreatableTool = 'rect' | 'ellipse' | 'sticky' | 'text';

export function createShapeAt(tool: CreatableTool, at: Point, authorName: string): Shape {
  const base = { id: newShapeId(), rotation: 0 };
  switch (tool) {
    case 'rect':
      return { ...base, type: 'rect', x: at.x - 60, y: at.y - 40, width: 120, height: 80, fill: '#93c5fd' };
    case 'ellipse':
      return { ...base, type: 'ellipse', x: at.x, y: at.y, width: 120, height: 80, fill: '#86efac' };
    case 'sticky':
      return {
        ...base,
        type: 'sticky',
        x: at.x - 80,
        y: at.y - 80,
        width: 160,
        height: 160,
        fill: '#fde68a',
        text: '',
        authorName: authorName.slice(0, 80),
      };
    case 'text':
      return { ...base, type: 'text', x: at.x, y: at.y, text: '', fontSize: 20, fill: DEFAULT_STROKE };
  }
}

export function createArrowShape(start: Point, end: Point, startShapeId?: string, endShapeId?: string): Shape {
  const arrow: Extract<Shape, { type: 'arrow' }> = {
    id: newShapeId(),
    type: 'arrow',
    x: start.x,
    y: start.y,
    rotation: 0,
    points: [0, 0, end.x - start.x, end.y - start.y],
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
  };
  if (startShapeId !== undefined) arrow.startShapeId = startShapeId;
  if (endShapeId !== undefined) arrow.endShapeId = endShapeId;
  return arrow;
}

/** The tools that are drawn by dragging out a box. Text is placed with a click instead. */
export type DraggableTool = 'rect' | 'ellipse' | 'sticky';

/** Smallest a dragged shape may be, so a stray flick still makes something grabbable. */
const MIN_DRAGGED_SIZE = 16;

/** A shape that fills a dragged box. An ellipse is positioned by its center, the others by their corner. */
export function createShapeInBox(tool: DraggableTool, box: Box, authorName: string): Shape {
  const width = Math.max(MIN_DRAGGED_SIZE, box.width);
  const height = Math.max(MIN_DRAGGED_SIZE, box.height);
  const base = createShapeAt(tool, { x: 0, y: 0 }, authorName);
  if (base.type === 'ellipse') return { ...base, x: box.x + width / 2, y: box.y + height / 2, width, height };
  if (base.type === 'rect' || base.type === 'sticky') return { ...base, x: box.x, y: box.y, width, height };
  return base;
}
