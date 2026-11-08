import type { Shape } from '@wb/shared';

/** Which style properties each shape type has, so the property bar only offers what applies. */

export type StyleKey = 'fill' | 'stroke' | 'strokeWidth' | 'opacity';

export const FILL_PALETTE = [
  '#fde68a',
  '#fca5a5',
  '#fdba74',
  '#86efac',
  '#93c5fd',
  '#c4b5fd',
  '#f9a8d4',
  '#e5e7eb',
  '#ffffff',
  '#111827',
] as const;

export const STROKE_PALETTE = ['#111827', '#dc2626', '#ea580c', '#16a34a', '#2563eb', '#7c3aed'] as const;

export const STROKE_WIDTHS = [1, 2, 4, 8] as const;

export function supportsStyle(shape: Shape, key: StyleKey): boolean {
  switch (key) {
    case 'fill':
      return shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'sticky' || shape.type === 'text';
    case 'stroke':
    case 'strokeWidth':
      return (
        shape.type === 'rect' ||
        shape.type === 'ellipse' ||
        shape.type === 'sticky' ||
        shape.type === 'path' ||
        shape.type === 'arrow'
      );
    case 'opacity':
      return true;
  }
}

export function styleValue(shape: Shape, key: StyleKey): string | number | undefined {
  switch (key) {
    case 'fill':
      return 'fill' in shape ? shape.fill : undefined;
    case 'stroke':
      return 'stroke' in shape ? shape.stroke : undefined;
    case 'strokeWidth':
      return 'strokeWidth' in shape ? shape.strokeWidth : undefined;
    case 'opacity':
      return shape.opacity ?? 1;
  }
}

/** The patch that sets one style property, or null when the value has the wrong kind. */
export function stylePatch(key: StyleKey, value: string | number): Partial<Shape> | null {
  if (typeof value === 'string') {
    if (key === 'fill') return { fill: value };
    if (key === 'stroke') return { stroke: value };
    return null;
  }
  if (key === 'strokeWidth') return { strokeWidth: value };
  if (key === 'opacity') return { opacity: value };
  return null;
}

/** The default ink, which is near-black. */
const DEFAULT_INK = '#111827';
/** What default ink looks like on a dark board. Only how it is drawn changes; the stored color does not. */
const DARK_INK = '#f3f4f6';

/**
 * Pens, arrows and text use the default ink unless someone picked a color. On a dark board that
 * would vanish, so it is drawn light instead. Chosen colors are left exactly as they were chosen.
 */
export function displayInk(color: string, dark: boolean): string {
  return dark && color.toLowerCase() === DEFAULT_INK ? DARK_INK : color;
}
