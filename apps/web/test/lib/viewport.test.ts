import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerOn,
  fitView,
  gridGap,
  lerpView,
  screenToWorld,
  viewportBounds,
  worldToScreen,
  zoomAt,
} from '@/lib/whiteboard/viewport';

const size = { width: 800, height: 600 };

describe('viewport', () => {
  it('converts between screen and world and back', () => {
    const view = { x: 120, y: -40, scale: 2 };
    const world = screenToWorld(view, { x: 320, y: 60 });
    expect(world).toEqual({ x: 100, y: 50 });
    expect(worldToScreen(view, world)).toEqual({ x: 320, y: 60 });
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const view = { x: 30, y: 70, scale: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(view, anchor);
    const next = zoomAt(view, anchor, 2.5);
    expect(screenToWorld(next, anchor).x).toBeCloseTo(before.x);
    expect(screenToWorld(next, anchor).y).toBeCloseTo(before.y);
  });

  it('clamps zoom to its limits', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 1000).scale).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0.0001).scale).toBe(MIN_ZOOM);
  });

  it('reports the visible world rectangle', () => {
    expect(viewportBounds({ x: -100, y: -50, scale: 2 }, size)).toEqual({ x: 50, y: 25, width: 400, height: 300 });
  });

  it('fits content into view and centers it', () => {
    const view = fitView({ x: 1000, y: 1000, width: 400, height: 300 }, size);
    const center = worldToScreen(view, { x: 1200, y: 1150 });
    expect(center.x).toBeCloseTo(400);
    expect(center.y).toBeCloseTo(300);
    const corner = worldToScreen(view, { x: 1000, y: 1000 });
    expect(corner.x).toBeGreaterThanOrEqual(0);
    expect(corner.y).toBeGreaterThanOrEqual(0);
  });

  it('does not blow a tiny shape up to fill the screen', () => {
    expect(fitView({ x: 0, y: 0, width: 10, height: 10 }, size).scale).toBeLessThanOrEqual(2);
  });

  it('resets an empty board to the origin', () => {
    expect(fitView(null, size)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('centers on a world point', () => {
    const view = centerOn({ x: 0, y: 0, scale: 1 }, size, { x: 500, y: 500 });
    expect(worldToScreen(view, { x: 500, y: 500 })).toEqual({ x: 400, y: 300 });
  });

  it('spaces the grid wider as you zoom out', () => {
    expect(gridGap(1)).toBe(24);
    expect(gridGap(0.1) * 0.1).toBeGreaterThanOrEqual(12);
    expect(gridGap(0.1)).toBeGreaterThan(gridGap(1));
  });

  it('interpolates views', () => {
    expect(lerpView({ x: 0, y: 0, scale: 1 }, { x: 100, y: 200, scale: 3 }, 0.5)).toEqual({ x: 50, y: 100, scale: 2 });
  });
});
