import type { Shape } from '@wb/shared';
import { describe, expect, it, vi } from 'vitest';
import { clearSpeakers, getSpeakingIds, setSpeakers, subscribeSpeaking } from '@/lib/huddle/speaking';
import { CULL_MARGIN_PX, cullBox, cullShapes, visibleWorldBox } from '@/lib/whiteboard/culling';

const rect = (id: string, x: number, y: number, w = 100, h = 100): Shape => ({
  id,
  type: 'rect',
  x,
  y,
  rotation: 0,
  width: w,
  height: h,
  fill: '#ffffff',
});
const byIdOf = (shapes: Shape[]) => new Map(shapes.map((s) => [s.id, s]));
const size = { width: 1000, height: 800 };
const none = new Set<string>();

describe('visible area', () => {
  it('is the screen in world units, widened by the margin', () => {
    const box = visibleWorldBox({ x: 0, y: 0, scale: 1 }, size, 100);
    expect(box).toEqual({ x: -100, y: -100, width: 1200, height: 1000 });
  });

  it('follows pan and zoom', () => {
    // Panned 500 px left at 2x: the screen starts at world x=250.
    const box = visibleWorldBox({ x: -500, y: -100, scale: 2 }, size, 0);
    expect(box).toEqual({ x: 250, y: 50, width: 500, height: 400 });
  });

  it('keeps the margin in screen pixels at any zoom', () => {
    const zoomedOut = visibleWorldBox({ x: 0, y: 0, scale: 0.5 }, size);
    expect(zoomedOut.x).toBe(-CULL_MARGIN_PX / 0.5);
  });
});

describe('cullShapes', () => {
  const view = { x: 0, y: 0, scale: 1 };

  it('keeps shapes on screen and drops ones far away', () => {
    const shapes = [rect('near', 100, 100), rect('far', 50_000, 50_000), rect('farLeft', -9000, 0)];
    const kept = cullShapes(shapes, byIdOf(shapes), view, size, none).map((s) => s.id);
    expect(kept).toEqual(['near']);
  });

  it('keeps a shape just beyond the edge so it is mounted before it scrolls in', () => {
    const shapes = [rect('edge', size.width + 100, 0)];
    expect(cullShapes(shapes, byIdOf(shapes), view, size, none)).toHaveLength(1);
  });

  it('keeps a huge shape that covers the screen even though no corner is visible', () => {
    const shapes = [rect('huge', -5000, -5000, 20_000, 20_000)];
    expect(cullShapes(shapes, byIdOf(shapes), view, size, none)).toHaveLength(1);
  });

  it('accounts for rotation', () => {
    const tall: Shape = { ...rect('tall', 0, 0, 10, 2000), rotation: 90 };
    // Turned a quarter, a 10x2000 bar reaches 2000 to the left of its origin: still touching the screen.
    const placed = { ...tall, x: 100, y: 100 };
    expect(cullShapes([placed], byIdOf([placed]), view, size, none)).toHaveLength(1);
  });

  it('always keeps what it is told to, wherever it is', () => {
    const shapes = [rect('selected', 90_000, 0), rect('other', 90_000, 0)];
    const kept = cullShapes(shapes, byIdOf(shapes), view, size, new Set(['selected'])).map((s) => s.id);
    expect(kept).toEqual(['selected']);
  });

  it('preserves the back-to-front order', () => {
    const shapes = [rect('a', 0, 0), rect('b', 9e6, 0), rect('c', 10, 10), rect('d', 20, 20)];
    expect(cullShapes(shapes, byIdOf(shapes), view, size, none).map((s) => s.id)).toEqual(['a', 'c', 'd']);
  });

  it('judges a connector by where it is drawn, between the shapes it joins', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 3000, 0);
    // Stored points are tiny and sit at the origin, but the arrow is drawn from a to b.
    const arrow: Shape = {
      id: 'arrow',
      type: 'arrow',
      x: 5000,
      y: 5000,
      rotation: 0,
      points: [0, 0, 1, 1],
      stroke: '#111827',
      strokeWidth: 3,
      startShapeId: 'a',
      endShapeId: 'b',
    };
    const all = [a, b, arrow];
    const ids = cullShapes(all, byIdOf(all), view, size, none).map((s) => s.id);
    expect(ids).toContain('arrow');
    expect(ids).not.toContain('b');
    expect(cullBox(arrow, byIdOf(all)).x).toBeLessThan(100);
  });

  it('keeps a long stroke whose first point is off screen', () => {
    const path: Shape = {
      id: 'p',
      type: 'path',
      x: -2000,
      y: 100,
      rotation: 0,
      points: [0, 0, 1500, 0, 2800, 10],
      stroke: '#111827',
      strokeWidth: 4,
    };
    expect(cullShapes([path], byIdOf([path]), view, size, none)).toHaveLength(1);
  });

  it('keeps everything until the canvas has been measured, or the zoom is nonsense', () => {
    const shapes = [rect('far', 1e7, 1e7)];
    expect(cullShapes(shapes, byIdOf(shapes), view, { width: 0, height: 0 }, none)).toHaveLength(1);
    expect(cullShapes(shapes, byIdOf(shapes), { x: 0, y: 0, scale: 0 }, size, none)).toHaveLength(1);
    expect(cullShapes(shapes, byIdOf(shapes), { x: 0, y: 0, scale: Number.NaN }, size, none)).toHaveLength(1);
  });

  it('draws far fewer shapes than exist on a big board, quickly', () => {
    const shapes: Shape[] = [];
    for (let i = 0; i < 10_000; i++) shapes.push(rect(`s${i}`, (i % 100) * 400, Math.floor(i / 100) * 300));
    const map = byIdOf(shapes);
    const started = performance.now();
    const kept = cullShapes(shapes, map, view, size, none);
    const elapsed = performance.now() - started;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(120);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('the speaking store', () => {
  const ADA = '11111111-2222-4333-8444-555555555555';
  const BOB = '99999999-8888-4777-8666-555555555555';

  it('ignores identities that are not user ids', () => {
    setSpeakers(['not-a-uuid', '<script>', '', ADA]);
    expect([...getSpeakingIds()]).toEqual([ADA]);
    clearSpeakers();
    expect(getSpeakingIds().size).toBe(0);
  });

  it('only notifies when the set really changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSpeaking(listener);
    setSpeakers([ADA]);
    setSpeakers([ADA]);
    expect(listener).toHaveBeenCalledTimes(1);
    const first = getSpeakingIds();
    setSpeakers([ADA]);
    expect(getSpeakingIds()).toBe(first);
    setSpeakers([BOB, ADA]);
    expect(listener).toHaveBeenCalledTimes(2);
    clearSpeakers();
    clearSpeakers();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    setSpeakers([ADA]);
    expect(listener).toHaveBeenCalledTimes(3);
    clearSpeakers();
  });
});
