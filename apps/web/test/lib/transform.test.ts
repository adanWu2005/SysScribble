import type { Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import { MIN_SHAPE_SIZE, normalizeDegrees, transformPatch } from '@/lib/whiteboard/transform';
import { STROKE_PALETTE, stylePatch, supportsStyle } from '@/lib/whiteboard/style';

const t = { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 };

describe('transformPatch', () => {
  it('bakes scale into width and height and keeps position and rotation', () => {
    const rect: Shape = { id: 'r', type: 'rect', x: 0, y: 0, rotation: 0, width: 100, height: 50, fill: '#ffffff' };
    expect(transformPatch(rect, { ...t, rotation: 30, scaleX: 2, scaleY: 3 })).toEqual({
      x: 10,
      y: 20,
      rotation: 30,
      width: 200,
      height: 150,
    });
  });

  it('never produces a shape smaller than the minimum', () => {
    const rect: Shape = { id: 'r', type: 'rect', x: 0, y: 0, rotation: 0, width: 100, height: 50, fill: '#ffffff' };
    const patch = transformPatch(rect, { ...t, scaleX: 0.0001, scaleY: 0.0001 });
    expect(patch).toMatchObject({ width: MIN_SHAPE_SIZE, height: MIN_SHAPE_SIZE });
  });

  it('treats a flip as a plain resize', () => {
    const rect: Shape = { id: 'r', type: 'rect', x: 0, y: 0, rotation: 0, width: 100, height: 50, fill: '#ffffff' };
    expect(transformPatch(rect, { ...t, scaleX: -2, scaleY: 1 })).toMatchObject({ width: 200 });
  });

  it('keeps rotation in the range 0 to 360', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
    expect(normalizeDegrees(0)).toBe(0);
  });

  it('scales the points of a pen stroke and leaves its line width alone', () => {
    const path: Shape = { id: 'p', type: 'path', x: 0, y: 0, rotation: 0, points: [0, 0, 10, 20], stroke: '#111827', strokeWidth: 3 };
    expect(transformPatch(path, { ...t, scaleX: 2, scaleY: 0.5 })).toMatchObject({ points: [0, 0, 20, 10] });
    expect(transformPatch(path, t)).not.toHaveProperty('strokeWidth');
  });

  it('scales text by font size and clamps it', () => {
    const text: Shape = { id: 't', type: 'text', x: 0, y: 0, rotation: 0, text: 'hi', fontSize: 20, fill: '#111827' };
    expect(transformPatch(text, { ...t, scaleX: 2, scaleY: 2 })).toMatchObject({ fontSize: 40 });
    expect(transformPatch(text, { ...t, scaleX: 100, scaleY: 100 })).toMatchObject({ fontSize: 200 });
    expect(transformPatch(text, { ...t, scaleX: 0.01, scaleY: 0.01 })).toMatchObject({ fontSize: 8 });
  });

  it('does not transform a connector', () => {
    const arrow: Shape = {
      id: 'a',
      type: 'arrow',
      x: 0,
      y: 0,
      rotation: 0,
      points: [0, 0, 5, 5],
      stroke: '#111827',
      strokeWidth: 3,
    };
    expect(transformPatch(arrow, { ...t, scaleX: 2 })).toBeNull();
  });
});

describe('style', () => {
  const rect: Shape = { id: 'r', type: 'rect', x: 0, y: 0, rotation: 0, width: 1, height: 1, fill: '#ffffff' };
  const path: Shape = { id: 'p', type: 'path', x: 0, y: 0, rotation: 0, points: [], stroke: '#111827', strokeWidth: 3 };
  const image: Shape = { id: 'i', type: 'image', x: 0, y: 0, rotation: 0, width: 1, height: 1, assetId: '2b9a3796-82a5-4c6f-b3ed-1da00920749b' };

  it('offers only the properties a shape has', () => {
    expect(supportsStyle(rect, 'fill')).toBe(true);
    expect(supportsStyle(path, 'fill')).toBe(false);
    expect(supportsStyle(path, 'stroke')).toBe(true);
    expect(supportsStyle(image, 'fill')).toBe(false);
    expect(supportsStyle(image, 'stroke')).toBe(false);
    expect(supportsStyle(image, 'opacity')).toBe(true);
  });

  it('builds the patch for a value of the right kind only', () => {
    expect(stylePatch('fill', STROKE_PALETTE[0])).toEqual({ fill: STROKE_PALETTE[0] });
    expect(stylePatch('opacity', 0.5)).toEqual({ opacity: 0.5 });
    expect(stylePatch('strokeWidth', 4)).toEqual({ strokeWidth: 4 });
    expect(stylePatch('fill', 3)).toBeNull();
    expect(stylePatch('opacity', '#ffffff')).toBeNull();
  });
});
